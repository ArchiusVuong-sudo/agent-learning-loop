import { randomUUID } from 'node:crypto';
import { all, audit, num, run, str } from '../db';
import { latestGate } from './gate';
import { startJob, type Job } from './jobs';
import { mapPool, runSupport } from './runner';
import { HELD_OUT_TRAFFIC } from './traffic';
import { candidateVersion, getVersion, liveVersion, setLive } from './versions';

export interface ShadowResult {
  requestId: string;
  version: string;
  role: 'live' | 'shadow';
  traceId: string;
  passed: boolean;
  reason: string;
  latencyMs: number;
  costUsd: number;
}

export interface ShadowPair {
  requestId: string;
  message: string;
  live: ShadowResult | null;
  shadow: ShadowResult | null;
}

/** Rollout steps need a passed gate for the current candidate. */
export async function passedGateForCandidate() {
  const [gate, candidate] = await Promise.all([latestGate(), candidateVersion()]);
  if (!gate || !candidate || gate.status !== 'passed' || gate.candidateVersion !== candidate.id) return null;
  return { gate, candidate };
}

/**
 * Sends held-out synthetic traffic to the live version and, in shadow, to the candidate, with
 * the same online checks. Customers would only ever see the live reply.
 */
export async function startShadowRun(): Promise<Job> {
  const ready = await passedGateForCandidate();
  if (!ready) throw new Error('A passed gate for the current candidate is required before a shadow run.');
  const live = await liveVersion();
  const runs = HELD_OUT_TRAFFIC.flatMap((req) => [
    { req, version: live.id, role: 'live' as const },
    { req, version: ready.candidate.id, role: 'shadow' as const },
  ]);
  return startJob('shadow', runs.length, async (job) => {
    await job.setRef(ready.gate.id);
    await run('DELETE FROM shadow_results WHERE gate_id = ?', [ready.gate.id]);
    const results = await mapPool(
      runs,
      6,
      async ({ req, version, role }) => {
        const out = await runSupport(req.message, { source: 'shadow', requestId: req.id, promptVersion: version });
        const reason = out.check.passed ? 'All online checks passed' : [out.check.judge.verdict === 'fail' ? out.check.judge.reason : '', ...out.check.rules.filter((r) => !r.passed).map((r) => r.detail)].filter(Boolean).join(' ');
        await run('INSERT INTO shadow_results (id, gate_id, request_id, version, role, trace_id, passed, reason, latency_ms, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
          randomUUID(),
          ready.gate.id,
          req.id,
          version,
          role,
          out.traceId,
          out.check.passed ? 1 : 0,
          reason,
          out.trace.durationMs ?? 0,
          out.trace.costUsd,
          new Date().toISOString(),
        ]);
      },
      (done) => void job.progress(done, `${done} of ${runs.length} runs checked`),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) throw new Error(`${failed.length} shadow run(s) failed: ${String((failed[0] as PromiseRejectedResult).reason)}`);
    const pairs = await shadowPairs(ready.gate.id);
    const livePass = pairs.filter((p) => p.live?.passed).length;
    const shadowPass = pairs.filter((p) => p.shadow?.passed).length;
    await audit('system', 'shadow_run_finished', { gate: ready.gate.id, live: live.id, shadow: ready.candidate.id, livePassed: livePass, shadowPassed: shadowPass, total: pairs.length });
    return `Shadow run: ${ready.candidate.id} passed ${shadowPass}/${pairs.length}, live ${live.id} passed ${livePass}/${pairs.length}`;
  });
}

export async function shadowPairs(gateId: string): Promise<ShadowPair[]> {
  const rows = await all('SELECT * FROM shadow_results WHERE gate_id = ?', [gateId], (row) => ({
    requestId: str(row.request_id),
    version: str(row.version),
    role: str(row.role) as ShadowResult['role'],
    traceId: str(row.trace_id),
    passed: num(row.passed) === 1,
    reason: str(row.reason),
    latencyMs: num(row.latency_ms),
    costUsd: num(row.cost_usd),
  }));
  return HELD_OUT_TRAFFIC.map((req) => ({
    requestId: req.id,
    message: req.message,
    live: rows.find((r) => r.requestId === req.id && r.role === 'live') ?? null,
    shadow: rows.find((r) => r.requestId === req.id && r.role === 'shadow') ?? null,
  }));
}

export async function promoteCandidate() {
  const ready = await passedGateForCandidate();
  if (!ready) throw new Error('Only a candidate with a passed gate can be promoted.');
  return setLive(ready.candidate.id, 'promote', { gate: ready.gate.id });
}

/** Restores the version the live one was built from. */
export async function rollback() {
  const live = await liveVersion();
  if (!live.parentId) throw new Error(`${live.id} has no earlier version to roll back to.`);
  if (!(await getVersion(live.parentId))) throw new Error(`Version ${live.parentId} is missing.`);
  return setLive(live.parentId, 'rollback', {});
}
