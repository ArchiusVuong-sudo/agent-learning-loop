import { describe, expect, it } from 'vitest';
import { providerStatus } from '@/lib/llm';
import { datasetSummary, listProposals } from '@/lib/loop/autoevals';
import { getChecks } from '@/lib/loop/checks';
import { getSignals } from '@/lib/loop/findings';
import { latestGate } from '@/lib/loop/gate';
import { promoteCandidate, rollback } from '@/lib/loop/rollout';
import { listSupportTraces } from '@/lib/loop/traces';
import { GOLDEN_CASES, HELD_OUT_TRAFFIC, SEED_TRAFFIC, TRY_SUGGESTIONS } from '@/lib/loop/traffic';
import { liveVersion, listVersions } from '@/lib/loop/versions';
import { runWalkthrough } from '@/lib/loop/walkthrough';
import { all, str } from '@/lib/db';
import { observabilityStore } from '@/lib/mastra';

describe('main flow in replay mode (no network)', () => {
  it('turns failing traces into approved cases, a gated prompt change and a reversible rollout', async () => {
    expect(providerStatus().mode).toBe('replay');
    const result = await runWalkthrough();

    // Traces: every seed and Try run is a Mastra trace of the support agent, with checks.
    const traces = await listSupportTraces({ sources: ['seed', 'try'] });
    expect(traces).toHaveLength(SEED_TRAFFIC.length + TRY_SUGGESTIONS.length * 2);
    expect(traces.every((t) => t.replayed && t.spans[0]?.type === 'agent_run')).toBe(true);
    expect(traces.some((t) => t.toolCalls.some((c) => c.name.startsWith('mcp__store__')))).toBe(true);
    const checks = await getChecks();
    expect(traces.every((t) => checks.has(t.traceId))).toBe(true);
    expect(traces.filter((t) => checks.get(t.traceId)?.passed === false).length).toBeGreaterThan(0);

    // Helper agents trace too, but never count as support traffic.
    const store = await observabilityStore();
    const helperRuns = await store.listTraces({ filters: { entityId: 'online-judge' }, pagination: { page: 0, perPage: 5 } });
    expect(helperRuns.spans.length).toBeGreaterThan(0);

    // Findings: signals for every trace, failure groups from failing ones.
    const signals = await getSignals();
    expect(traces.every((t) => signals.has(t.traceId))).toBe(true);
    expect(result.groups.length).toBeGreaterThan(0);

    // Autoevals: approved cases joined the golden set as dataset version 2; the rejected one did not.
    const dataset = await datasetSummary();
    expect(result.datasetVersion).toBe(2);
    expect(dataset.items.filter((i) => i.metadata.golden)).toHaveLength(GOLDEN_CASES.length);
    const proposals = await listProposals();
    expect(proposals.filter((p) => p.status === 'added')).toHaveLength(3);
    expect(proposals.some((p) => p.status === 'rejected')).toBe(true);
    expect(dataset.items).toHaveLength(GOLDEN_CASES.length + 3);

    // Gate: the recorded path ends with a passed gate on a candidate, with the same pinned version.
    const gate = await latestGate();
    expect(gate?.status).toBe('passed');
    expect(result.gates.at(-1)).toEqual({ candidateVersion: result.candidate, status: 'passed' });
    expect(gate!.datasetVersion).toBe(2);
    expect(gate!.report!.rows).toHaveLength(dataset.items.length);
    expect(gate!.report!.rules.every((r) => r.passed)).toBe(true);
    expect(gate!.report!.rows.some((r) => r.status === 'fixed')).toBe(true);
    expect(gate!.report!.rows.filter((r) => r.golden).every((r) => r.status !== 'regressed')).toBe(true);

    // Rollout: shadow results for every held-out request, then promote and roll back.
    expect(result.shadow?.total).toBe(HELD_OUT_TRAFFIC.length);
    expect((await liveVersion()).id).toBe('v1');
    await promoteCandidate();
    expect((await liveVersion()).id).toBe(result.candidate);
    await rollback();
    expect((await liveVersion()).id).toBe('v1');
    expect((await listVersions()).filter((v) => v.status === 'live')).toHaveLength(1);
    const actions = await all('SELECT action FROM audit_log ORDER BY id', [], (r) => str(r.action));
    expect(actions).toEqual(expect.arrayContaining(['cases_added', 'candidate_saved', 'suggestion_approved', 'gate_passed', 'shadow_run_finished', 'promote', 'rollback']));
  }, 120_000);
});
