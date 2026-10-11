import { addApprovedToDataset, listProposals, proposeCases, updateProposal } from './autoevals';
import { currentFailureGroups } from './findings';
import { latestGate, startGate, type Gate } from './gate';
import { waitForJob, type Job } from './jobs';
import { ensureSetup, startAnalysis, startSeedTraffic } from './pipeline';
import { shadowPairs, startShadowRun } from './rollout';
import { mapPool, runSupport } from './runner';
import { approveSuggestion, suggestFromState } from './suggestions';
import { listSupportTraces } from './traces';
import { TRY_SUGGESTIONS } from './traffic';
import { liveVersion } from './versions';

export interface WalkthroughResult {
  seedMessage: string;
  groups: Array<{ behavior: string; count: number }>;
  datasetVersion: number;
  gates: Array<Pick<Gate, 'candidateVersion' | 'status'>>;
  shadow: { live: number; shadow: number; total: number } | null;
  candidate: string;
}

async function finish(job: Job, log: (m: string) => void): Promise<Job> {
  const done = await waitForJob(job.id);
  if (done.status === 'error') throw new Error(`${done.kind} job failed: ${done.error}`);
  log(`${done.kind}: ${done.message}`);
  return done;
}

async function tryBox(version: string, log: (m: string) => void) {
  await mapPool(TRY_SUGGESTIONS, 3, (message, i) => runSupport(message, { source: 'try', requestId: `try-${version}-${i + 1}`, promptVersion: version }));
  log(`try box: ${TRY_SUGGESTIONS.length} suggested messages on ${version}`);
}

/**
 * The main flow, the way a reviewer clicks through it: traffic, Try box, findings, cases for the
 * largest failure group (approve three, reject one), a suggestion, the gate, a revision when the
 * gate fails, then the shadow run. `pnpm record` runs it live; the end-to-end test replays it.
 */
export async function runWalkthrough(log: (message: string) => void = () => undefined): Promise<WalkthroughResult> {
  await ensureSetup();
  const seed = await finish(await startSeedTraffic(), log);
  const v1 = await liveVersion();
  await tryBox(v1.id, log);
  await finish(await startAnalysis(), log);

  const groups = await currentFailureGroups(await listSupportTraces({ sources: ['seed', 'try'] }));
  log(`failure groups: ${groups.map((g) => `${g.behavior}=${g.count}`).join(', ')}`);
  if (!groups.length) throw new Error('No failing traces: the loop has nothing to learn from');
  await mapPool(groups, 3, (group) => proposeCases(group));
  const top = groups[0]!;
  for (const [index, card] of (await listProposals(top.behavior)).entries()) {
    await updateProposal(card.id, { status: index < 3 ? 'approved' : 'rejected' });
  }
  const added = await addApprovedToDataset();
  log(`dataset: +${added.added} cases from "${top.label}", now version ${added.version}`);

  const gates: WalkthroughResult['gates'] = [];
  let suggestion = await suggestFromState({ revise: false });
  log(`suggestion: ${suggestion.edits.length} edit(s): ${suggestion.summary}`);
  let candidate = await approveSuggestion(suggestion.id);
  await finish(await startGate(), log);
  let gate = await latestGate();
  gates.push({ candidateVersion: candidate.id, status: gate!.status });
  // A failed gate goes back to the learner with its failing rows, as the Suggestion page offers.
  for (let round = 1; gate?.status === 'failed' && round <= 2; round++) {
    suggestion = await suggestFromState({ revise: true });
    log(`revision ${round}: ${suggestion.edits.length} edit(s): ${suggestion.summary}`);
    candidate = await approveSuggestion(suggestion.id);
    await finish(await startGate(), log);
    gate = await latestGate();
    gates.push({ candidateVersion: candidate.id, status: gate!.status });
  }

  let shadow: WalkthroughResult['shadow'] = null;
  if (gate?.status === 'passed') {
    await finish(await startShadowRun(), log);
    const pairs = await shadowPairs(gate.id);
    shadow = { live: pairs.filter((p) => p.live?.passed).length, shadow: pairs.filter((p) => p.shadow?.passed).length, total: pairs.length };
  }
  await tryBox(candidate.id, log);
  await finish(await startAnalysis(), log);
  return { seedMessage: seed.message, groups: groups.map((g) => ({ behavior: g.behavior, count: g.count })), datasetVersion: added.version, gates, shadow, candidate: candidate.id };
}
