import { config } from '../config';
import { seedStore } from '../store/repo';
import { getChecks } from './checks';
import { analyzeTrace, getSignals } from './findings';
import { startJob, type Job } from './jobs';
import { mapPool, runSupport } from './runner';
import { listSupportTraces } from './traces';
import { SEED_TRAFFIC } from './traffic';
import { ensureBaseVersion, liveVersion } from './versions';

/** Store rows and prompt v1. Safe to call on every request. */
export async function ensureSetup(): Promise<void> {
  await seedStore(config.storeToday);
  await ensureBaseVersion();
}

/** Runs the synthetic production traffic through the live prompt, with online checks. */
export async function startSeedTraffic(): Promise<Job> {
  await ensureSetup();
  const live = await liveVersion();
  return startJob('seed', SEED_TRAFFIC.length, async (job) => {
    const results = await mapPool(
      SEED_TRAFFIC,
      config.maxConcurrentRuns,
      (req) => runSupport(req.message, { source: 'seed', requestId: req.id, promptVersion: live.id }),
      (done) => void job.progress(done, `${done} of ${SEED_TRAFFIC.length} requests`),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length === SEED_TRAFFIC.length) throw new Error(`Every run failed: ${String((failed[0] as PromiseRejectedResult).reason)}`);
    const passed = results.filter((r) => r.status === 'fulfilled' && r.value.check.passed).length;
    return `${SEED_TRAFFIC.length - failed.length} traces on ${live.id}: ${passed} passed online checks${failed.length ? `, ${failed.length} runs errored` : ''}`;
  });
}

/** Tags every seed and Try trace that has no signals yet. */
export async function startAnalysis(): Promise<Job> {
  const [traces, signals, checks] = await Promise.all([listSupportTraces({ sources: ['seed', 'try'] }), getSignals(), getChecks()]);
  const todo = traces.filter((t) => !signals.has(t.traceId));
  return startJob('analyze', todo.length, async (job) => {
    const results = await mapPool(
      todo,
      config.maxConcurrentRuns,
      (trace) => analyzeTrace(trace, checks.get(trace.traceId)),
      (done) => void job.progress(done, `${done} of ${todo.length} traces tagged`),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length && failed.length === todo.length) throw new Error(`Analysis failed: ${String((failed[0] as PromiseRejectedResult).reason)}`);
    return `${todo.length - failed.length} traces tagged`;
  });
}
