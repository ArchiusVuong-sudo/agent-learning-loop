import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { all, audit, getState, json, num, one, run, setState, str } from '../db';
import { agents, getMastra } from '../mastra';
import { STORE_TOOL_NAMES, toolName } from '../store/tools';
import type { FailureGroup } from './findings';
import { BEHAVIORS, type Behavior } from './prompts';
import { groundTruthSchema } from './scorers';
import { GOLDEN_CASES } from './traffic';

export const DATASET_NAME = 'support-regression';
const FULL_TOOL_NAMES = STORE_TOOL_NAMES.map(toolName) as [string, ...string[]];

export const evalCaseSchema = z.object({
  title: z.string().min(3).max(90),
  kind: z.enum(['from_trace', 'variant']),
  input: z.string().min(10).max(600),
  must: z.array(z.string().min(3).max(240)).min(1).max(5),
  mustNot: z.array(z.string().min(3).max(240)).max(4),
  expectedToolPath: z.array(z.enum(FULL_TOOL_NAMES)).max(4),
  sourceRequestIds: z.array(z.string().max(12)).max(6),
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const authorOutputSchema = z.object({ cases: z.array(evalCaseSchema).min(3).max(4) });

export interface CaseProposal {
  id: string;
  behavior: string;
  status: 'proposed' | 'approved' | 'rejected' | 'added';
  body: EvalCase;
  datasetItemId: string | null;
  datasetVersion: number | null;
  createdAt: string;
}

const toProposal = (row: Record<string, unknown>): CaseProposal => ({
  id: str(row.id),
  behavior: str(row.behavior),
  status: str(row.status) as CaseProposal['status'],
  body: json<EvalCase>(row.body, {} as EvalCase),
  datasetItemId: row.dataset_item_id ? str(row.dataset_item_id) : null,
  datasetVersion: row.dataset_version === null || row.dataset_version === undefined ? null : num(row.dataset_version),
  createdAt: str(row.created_at),
});

export function authorPrompt(group: FailureGroup): string {
  const examples = group.traces
    .slice(0, 6)
    .map((t) => `### Request ${t.requestId ?? 'unknown'}\n${t.rendered}\nWhy it failed: ${t.reason}`)
    .join('\n\n');
  return `Failure group: ${group.behavior} (${group.label}), ${group.count} failing traces.\n\nStore tools: ${FULL_TOOL_NAMES.join(', ')}\n\n${examples}`;
}

/** Drafts 3-4 eval cases for one failure group. They wait for a person before joining the dataset. */
export async function proposeCases(group: FailureGroup): Promise<CaseProposal[]> {
  const out = (await agents().evalAuthor.generate(authorPrompt(group), {
    structuredOutput: { schema: authorOutputSchema },
    anchor: `cases::${group.behavior}`,
    tracingOptions: { metadata: { source: 'eval-author', behavior: group.behavior } },
  })) as { object: z.infer<typeof authorOutputSchema> };
  await run("DELETE FROM case_proposals WHERE behavior = ? AND status IN ('proposed', 'rejected')", [group.behavior]);
  const now = new Date().toISOString();
  for (const body of out.object.cases) {
    await run('INSERT INTO case_proposals (id, behavior, status, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), group.behavior, 'proposed', JSON.stringify(body), now, now]);
  }
  return listProposals(group.behavior);
}

export async function listProposals(behavior?: string): Promise<CaseProposal[]> {
  return behavior
    ? all('SELECT * FROM case_proposals WHERE behavior = ? ORDER BY created_at, rowid', [behavior], toProposal)
    : all('SELECT * FROM case_proposals ORDER BY created_at, rowid', [], toProposal);
}

/** A reviewer's edit. The case is validated again so a bad edit cannot reach the dataset. */
export async function updateProposal(id: string, patch: { status?: 'proposed' | 'approved' | 'rejected'; body?: unknown }): Promise<CaseProposal> {
  const current = await one('SELECT * FROM case_proposals WHERE id = ?', [id], toProposal);
  if (!current) throw new Error('Case not found');
  if (current.status === 'added') throw new Error('This case is already in the dataset');
  const body = patch.body === undefined ? current.body : evalCaseSchema.parse(patch.body);
  await run('UPDATE case_proposals SET status = ?, body = ?, updated_at = ? WHERE id = ?', [patch.status ?? current.status, JSON.stringify(body), new Date().toISOString(), id]);
  return (await one('SELECT * FROM case_proposals WHERE id = ?', [id], toProposal))!;
}

function itemFor(c: { input: string; must: string[]; mustNot: string[]; expectedToolPath: string[] }, metadata: Record<string, unknown>) {
  return {
    input: c.input,
    groundTruth: { must: c.must, mustNot: c.mustNot },
    ...(c.expectedToolPath.length
      ? { expectedTrajectory: { steps: c.expectedToolPath.map((name) => ({ name, stepType: 'mcp_tool_call' as const })), ordering: 'relaxed' as const } }
      : {}),
    metadata,
  };
}

/** The Mastra dataset that holds the golden set plus every approved case. Created on first use. */
export async function ensureDataset() {
  const { mastra } = getMastra();
  const existingId = await getState('datasetId');
  if (existingId) {
    try {
      return await mastra.datasets.get({ id: existingId });
    } catch {
      // The Mastra store was reset; create a new dataset below.
    }
  }
  const dataset = await mastra.datasets.create({
    name: DATASET_NAME,
    description: 'Golden support cases plus regression cases approved from failing traces. Synthetic data.',
    groundTruthSchema,
  });
  await dataset.addItems({
    items: GOLDEN_CASES.map((g) => ({ ...itemFor(g, { title: g.title, golden: true, kind: 'golden', caseId: g.id, sourceRequestIds: [] }), source: { type: 'json' as const, referenceId: g.id } })),
  });
  await setState('datasetId', dataset.id);
  return dataset;
}

export async function datasetSummary() {
  const dataset = await ensureDataset();
  const details = await dataset.getDetails();
  const listed = await dataset.listItems({ page: 0, perPage: 100 });
  const items = Array.isArray(listed) ? listed : listed.items;
  return {
    id: dataset.id,
    name: details.name,
    version: details.version,
    items: items.map((item) => ({
      id: item.id,
      input: String(item.input),
      groundTruth: item.groundTruth as { must: string[]; mustNot: string[] },
      expectedToolPath: ((item.expectedTrajectory as { steps?: Array<{ name: string }> } | undefined)?.steps ?? []).map((s) => s.name),
      metadata: (item.metadata ?? {}) as { title?: string; golden?: boolean; kind?: string; sourceRequestIds?: string[] },
      datasetVersion: item.datasetVersion,
    })),
  };
}

/** Adds every approved case to the dataset as one batch, so the version goes up by one. */
export async function addApprovedToDataset(): Promise<{ added: number; version: number }> {
  const approved = await all("SELECT * FROM case_proposals WHERE status = 'approved' ORDER BY created_at, rowid", [], toProposal);
  const dataset = await ensureDataset();
  if (approved.length === 0) return { added: 0, version: (await dataset.getDetails()).version };
  const items = await dataset.addItems({
    items: approved.map((p) => ({
      ...itemFor(p.body, { title: p.body.title, golden: false, kind: p.body.kind, behavior: p.behavior, behaviorLabel: BEHAVIORS[p.behavior as Behavior]?.label ?? p.behavior, sourceRequestIds: p.body.sourceRequestIds, caseId: p.id }),
      source: { type: 'llm' as const, referenceId: p.id },
    })),
  });
  const version = (await dataset.getDetails()).version;
  for (const [index, proposal] of approved.entries()) {
    await run("UPDATE case_proposals SET status = 'added', dataset_item_id = ?, dataset_version = ?, updated_at = ? WHERE id = ?", [items[index]?.id ?? null, version, new Date().toISOString(), proposal.id]);
  }
  await audit('reviewer', 'cases_added', { count: approved.length, datasetVersion: version, rejected: (await listProposals()).filter((p) => p.status === 'rejected').length });
  return { added: approved.length, version };
}
