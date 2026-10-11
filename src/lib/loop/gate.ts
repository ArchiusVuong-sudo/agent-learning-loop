import { randomUUID } from 'node:crypto';
import { SUPPORT_AGENT_ID } from '../agents';
import { all, audit, json, one, run, str } from '../db';
import { getMastra } from '../mastra';
import { datasetSummary, ensureDataset } from './autoevals';
import { startJob, type Job } from './jobs';
import { CASE_JUDGE_SCORER_ID, TRAJECTORY_SCORER_ID } from './scorers';
import { getTraceView } from './traces';
import { candidateVersion, liveVersion } from './versions';

export interface ItemScore {
  judge: number | null;
  judgeReason: string;
  trajectory: number | null;
  toolPath: string[];
  error: string | null;
  latencyMs: number | null;
  costUsd: number;
  traceId: string | null;
  reply: string;
}

export interface GateItem {
  itemId: string;
  title: string;
  input: string;
  golden: boolean;
  expectedToolPath: string[];
}

export type RowStatus = 'fixed' | 'regressed' | 'still_passing' | 'still_failing';

export interface MatrixRow extends GateItem {
  base: ItemScore & { passed: boolean };
  candidate: ItemScore & { passed: boolean };
  status: RowStatus;
}

export interface GateRule {
  id: 'tool_paths' | 'golden_holds' | 'net_improvement';
  label: string;
  passed: boolean;
  detail: string;
}

export interface VersionStats {
  version: string;
  passed: number;
  total: number;
  avgLatencyMs: number;
  totalCostUsd: number;
}

export interface GateReport {
  rows: MatrixRow[];
  rules: GateRule[];
  passed: boolean;
  base: VersionStats;
  candidate: VersionStats;
}

/** An item passes when the judge passes it and, if it has an expected tool path, the path scores 1.0. */
export function itemPassed(item: Pick<GateItem, 'expectedToolPath'>, score: ItemScore): boolean {
  if (score.error) return false;
  if (score.judge !== 1) return false;
  return item.expectedToolPath.length === 0 || score.trajectory === 1;
}

function stats(version: string, scores: Array<ItemScore & { passed: boolean }>): VersionStats {
  const latencies = scores.map((s) => s.latencyMs).filter((v): v is number => typeof v === 'number');
  return {
    version,
    passed: scores.filter((s) => s.passed).length,
    total: scores.length,
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    totalCostUsd: scores.reduce((sum, s) => sum + s.costUsd, 0),
  };
}

/**
 * The verdict, computed by the app from both experiments' per-item scores (Mastra experiments
 * have no gates of their own). Pure, so every rule is unit tested.
 */
export function computeVerdict(items: GateItem[], base: Map<string, ItemScore>, candidate: Map<string, ItemScore>, versions: { base: string; candidate: string }): GateReport {
  const missing: ItemScore = { judge: null, judgeReason: 'No result', trajectory: null, toolPath: [], error: 'No result', latencyMs: null, costUsd: 0, traceId: null, reply: '' };
  const rows: MatrixRow[] = items.map((item) => {
    const b = base.get(item.itemId) ?? missing;
    const c = candidate.get(item.itemId) ?? missing;
    const bp = itemPassed(item, b);
    const cp = itemPassed(item, c);
    const status: RowStatus = bp && cp ? 'still_passing' : !bp && cp ? 'fixed' : bp && !cp ? 'regressed' : 'still_failing';
    return { ...item, base: { ...b, passed: bp }, candidate: { ...c, passed: cp }, status };
  });

  const badPaths = rows.filter((r) => r.expectedToolPath.length > 0 && r.candidate.trajectory !== 1);
  const goldenRegressions = rows.filter((r) => r.golden && r.status === 'regressed');
  const baseStats = stats(versions.base, rows.map((r) => r.base));
  const candStats = stats(versions.candidate, rows.map((r) => r.candidate));

  const rules: GateRule[] = [
    {
      id: 'tool_paths',
      label: `Every expected tool path scores 1.0 on ${versions.candidate}`,
      passed: badPaths.length === 0,
      detail: badPaths.length ? `${badPaths.length} item(s) below 1.0: ${badPaths.map((r) => r.title).join(', ')}` : `${rows.filter((r) => r.expectedToolPath.length).length} item(s) with a tool path, all at 1.0`,
    },
    {
      id: 'golden_holds',
      label: 'No golden case goes from pass to fail',
      passed: goldenRegressions.length === 0,
      detail: goldenRegressions.length ? `Regressed: ${goldenRegressions.map((r) => r.title).join(', ')}` : `${rows.filter((r) => r.golden).length} golden case(s) checked`,
    },
    {
      id: 'net_improvement',
      label: `${versions.candidate} passes more cases than ${versions.base}`,
      passed: candStats.passed > baseStats.passed,
      detail: `${versions.base}: ${baseStats.passed}/${baseStats.total}, ${versions.candidate}: ${candStats.passed}/${candStats.total}`,
    },
  ];
  return { rows, rules, passed: rules.every((r) => r.passed), base: baseStats, candidate: candStats };
}

export interface Gate {
  id: string;
  datasetId: string;
  datasetVersion: number;
  baseVersion: string;
  candidateVersion: string;
  baseExperimentId: string | null;
  candidateExperimentId: string | null;
  status: 'running' | 'passed' | 'failed' | 'error';
  report: GateReport | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const toGate = (row: Record<string, unknown>): Gate => ({
  id: str(row.id),
  datasetId: str(row.dataset_id),
  datasetVersion: Number(row.dataset_version),
  baseVersion: str(row.base_version),
  candidateVersion: str(row.candidate_version),
  baseExperimentId: row.base_experiment_id ? str(row.base_experiment_id) : null,
  candidateExperimentId: row.candidate_experiment_id ? str(row.candidate_experiment_id) : null,
  status: str(row.status) as Gate['status'],
  report: json<GateReport | null>(row.report, null),
  error: row.error ? str(row.error) : null,
  createdAt: str(row.created_at),
  finishedAt: row.finished_at ? str(row.finished_at) : null,
});

export async function latestGate(): Promise<Gate | null> {
  return one('SELECT * FROM gates ORDER BY created_at DESC LIMIT 1', [], toGate);
}

export async function getGate(id: string): Promise<Gate | null> {
  return one('SELECT * FROM gates WHERE id = ?', [id], toGate);
}

export async function listGates(): Promise<Gate[]> {
  return all('SELECT * FROM gates ORDER BY created_at DESC', [], toGate);
}

type ExperimentResult = { itemId: string; output: unknown; error: { message: string } | null; scores: Array<{ scorerId: string; score: number | null; reason: string | null; error: string | null }> };

async function toScores(results: ExperimentResult[]): Promise<Map<string, ItemScore>> {
  const map = new Map<string, ItemScore>();
  for (const result of results) {
    const output = (result.output ?? {}) as { text?: string; traceId?: string | null };
    const judge = result.scores.find((s) => s.scorerId === CASE_JUDGE_SCORER_ID);
    const trajectory = result.scores.find((s) => s.scorerId === TRAJECTORY_SCORER_ID);
    const view = output.traceId ? await getTraceView(output.traceId) : null;
    map.set(result.itemId, {
      judge: judge?.score ?? null,
      judgeReason: judge?.reason ?? judge?.error ?? '',
      trajectory: trajectory?.score ?? null,
      toolPath: view?.toolCalls.map((c) => c.name) ?? [],
      error: result.error?.message ?? null,
      latencyMs: view?.durationMs ?? null,
      costUsd: view?.costUsd ?? 0,
      traceId: output.traceId ?? null,
      reply: output.text ?? '',
    });
  }
  return map;
}

/**
 * Runs the candidate and the live version as two Mastra experiments on the same pinned dataset
 * version. The prompt version travels in requestContext; Mastra's `agentVersion` needs the
 * editor's stored versions, so it is recorded in experiment metadata instead.
 */
export async function startGate(): Promise<Job> {
  const candidate = await candidateVersion();
  if (!candidate) throw new Error('Approve a suggestion first: there is no candidate version.');
  const base = await liveVersion();
  const dataset = await ensureDataset();
  const summary = await datasetSummary();
  const gateId = randomUUID();
  const items: GateItem[] = summary.items.map((i) => ({ itemId: i.id, title: i.metadata.title ?? i.input.slice(0, 60), input: i.input, golden: i.metadata.golden === true, expectedToolPath: i.expectedToolPath }));

  return startJob('gate', items.length * 2, async (job) => {
    await job.setRef(gateId);
    await run('INSERT INTO gates (id, dataset_id, dataset_version, base_version, candidate_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      gateId,
      dataset.id,
      summary.version,
      base.id,
      candidate.id,
      'running',
      new Date().toISOString(),
    ]);
    const { scorers } = getMastra();
    let done = 0;
    const runOne = (version: string) =>
      dataset.startExperiment({
        name: `${version} on ${summary.name} v${summary.version}`,
        description: `Gate ${gateId.slice(0, 8)}: prompt ${version}`,
        targetType: 'agent',
        targetId: SUPPORT_AGENT_ID,
        version: summary.version,
        scorers: [scorers.caseJudge, scorers.trajectory],
        requestContext: { promptVersion: version },
        metadata: { promptVersion: version, gateId, role: version === candidate.id ? 'candidate' : 'base' },
        maxConcurrency: 3,
        maxRetries: 1,
        onEvent: async (event) => {
          if (event.type === 'experiment.item.completed') await job.progress(++done, `${done} of ${items.length * 2} runs scored`);
        },
      });
    try {
      const [baseRun, candRun] = await Promise.all([runOne(base.id), runOne(candidate.id)]);
      await run('UPDATE gates SET base_experiment_id = ?, candidate_experiment_id = ? WHERE id = ?', [baseRun.experimentId, candRun.experimentId, gateId]);
      const report = computeVerdict(items, await toScores(baseRun.results as ExperimentResult[]), await toScores(candRun.results as ExperimentResult[]), { base: base.id, candidate: candidate.id });
      const status = report.passed ? 'passed' : 'failed';
      await run('UPDATE gates SET status = ?, report = ?, finished_at = ? WHERE id = ?', [status, JSON.stringify(report), new Date().toISOString(), gateId]);
      await audit('system', `gate_${status}`, { gate: gateId, base: base.id, candidate: candidate.id, datasetVersion: summary.version, basePassed: report.base.passed, candidatePassed: report.candidate.passed, total: items.length });
      return `Gate ${status}: ${report.candidate.passed}/${items.length} on ${candidate.id} vs ${report.base.passed}/${items.length} on ${base.id}`;
    } catch (error) {
      await run("UPDATE gates SET status = 'error', error = ?, finished_at = ? WHERE id = ?", [error instanceof Error ? error.message : String(error), new Date().toISOString(), gateId]);
      throw error;
    }
  });
}
