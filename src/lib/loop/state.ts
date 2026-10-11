import { config } from '../config';
import { providerStatus } from '../llm';
import { datasetSummary, listProposals } from './autoevals';
import { getChecks } from './checks';
import { getSignals } from './findings';
import { latestGate } from './gate';
import { latestJobs } from './jobs';
import { ensureSetup } from './pipeline';
import { latestSuggestion } from './suggestions';
import { listSupportTraces } from './traces';
import { candidateVersion, liveVersion } from './versions';

export type StepState = 'done' | 'ready' | 'locked';

/** Everything the shell (sidebar and header) needs, read fresh on each request. */
export async function shellState() {
  await ensureSetup();
  const [live, candidate, traces, checks, signals, proposals, suggestion, gate, jobs, dataset] = await Promise.all([
    liveVersion(),
    candidateVersion(),
    listSupportTraces({ sources: ['seed', 'try'] }),
    getChecks(),
    getSignals(),
    listProposals(),
    latestSuggestion(),
    latestGate(),
    latestJobs(),
    datasetSummary(),
  ]);
  const failing = traces.filter((t) => checks.get(t.traceId)?.passed === false).length;
  const tagged = traces.filter((t) => signals.has(t.traceId)).length;
  const added = proposals.filter((p) => p.status === 'added').length;
  const status = providerStatus();
  const steps: Record<'traces' | 'findings' | 'evals' | 'suggestion' | 'gate' | 'rollout', StepState> = {
    traces: traces.length ? 'done' : 'ready',
    findings: tagged ? 'done' : traces.length ? 'ready' : 'locked',
    evals: added ? 'done' : tagged ? 'ready' : 'locked',
    suggestion: suggestion?.status === 'approved' ? 'done' : added ? 'ready' : 'locked',
    gate: gate && gate.status !== 'running' && gate.status !== 'error' ? 'done' : candidate ? 'ready' : 'locked',
    rollout: live.id !== 'v1' ? 'done' : gate?.status === 'passed' ? 'ready' : 'locked',
  };
  return {
    mode: status.mode,
    modeReason: status.reason,
    models: config.models,
    live,
    candidate,
    counts: { traces: traces.length, failing, tagged, added, datasetVersion: dataset.version, datasetItems: dataset.items.length },
    steps,
    jobs,
  };
}

export type ShellState = Awaited<ReturnType<typeof shellState>>;
