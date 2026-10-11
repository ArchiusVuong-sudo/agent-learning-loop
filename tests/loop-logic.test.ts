import { describe, expect, it } from 'vitest';
import { evalCaseSchema } from '@/lib/loop/autoevals';
import { renderTrace, spanRules, type CheckResult } from '@/lib/loop/checks';
import { groupFailures } from '@/lib/loop/findings';
import { computeVerdict, itemPassed, type GateItem, type ItemScore } from '@/lib/loop/gate';
import { EditError, applyEdits, learnerOutputSchema, lineDiff } from '@/lib/loop/suggestions';
import type { ToolCallView, TraceView } from '@/lib/loop/traces';

const call = (shortName: string, input: unknown, output: unknown = {}, isError = false): ToolCallView => ({ name: `mcp__store__${shortName}`, shortName, input, output, isError, durationMs: 5 });
const trace = (toolCalls: ToolCallView[], reply = 'Done.', patch: Partial<TraceView> = {}): TraceView => ({
  traceId: 't1',
  requestId: 'S01',
  source: 'seed',
  promptVersion: 'v1',
  experimentId: null,
  startedAt: '',
  durationMs: 1000,
  input: 'Can I return ORD-20512?',
  reply,
  error: null,
  toolCalls,
  costUsd: 0,
  model: 'm',
  replayed: true,
  spans: [],
  ...patch,
});
const rule = (view: TraceView, id: string) => spanRules(view).find((r) => r.id === id)!;

describe('span rules', () => {
  it('flags tool errors', () => {
    expect(rule(trace([call('create_return', { orderId: 'ORD-1' }, 'Return refused', true)]), 'tool_errors').passed).toBe(false);
    expect(rule(trace([call('lookup_order', { orderId: 'ORD-1' })]), 'tool_errors').passed).toBe(true);
  });

  it('requires an eligibility check for the same order before create_return', () => {
    expect(rule(trace([call('create_return', { orderId: 'ORD-20705' })]), 'eligibility_before_return').passed).toBe(false);
    expect(rule(trace([call('check_return_eligibility', { orderId: 'ORD-20705' }), call('create_return', { orderId: 'ORD-20705' })]), 'eligibility_before_return').passed).toBe(true);
    expect(rule(trace([call('check_return_eligibility', { orderId: 'ORD-1' }), call('create_return', { orderId: 'ORD-2' })]), 'eligibility_before_return').passed).toBe(false);
  });

  it('wants a policy or eligibility lookup behind window claims', () => {
    expect(rule(trace([call('lookup_order', {})], 'You have a 30-day return window.'), 'policy_grounding').passed).toBe(false);
    expect(rule(trace([call('search_policy', {})], 'You have a 30-day return window.'), 'policy_grounding').passed).toBe(true);
    expect(rule(trace([], 'Your order shipped yesterday.'), 'policy_grounding').passed).toBe(true);
  });

  it('wants an escalation when a tool says a human must decide', () => {
    const needs = call('check_return_eligibility', { orderId: 'ORD-20589' }, { requiresEscalation: true });
    expect(rule(trace([needs]), 'required_escalation').passed).toBe(false);
    expect(rule(trace([needs, call('escalate_to_human', {})]), 'required_escalation').passed).toBe(true);
  });

  it('renders a trace for judges without trace ids', () => {
    const text = renderTrace(trace([call('lookup_order', { orderId: 'ORD-20512' }, { opened: true })], 'No.'));
    expect(text).toContain('lookup_order({"orderId":"ORD-20512"})');
    expect(text).not.toContain('t1');
  });
});

describe('failure groups', () => {
  const failed = (id: string): CheckResult => ({ traceId: id, passed: false, rules: [], judge: { verdict: 'fail', reason: `reason ${id}`, issues: [] } });
  const passed = (id: string): CheckResult => ({ traceId: id, passed: true, rules: [], judge: { verdict: 'pass', reason: 'ok', issues: [] } });

  it('groups failed traces by negative behavior, largest first', () => {
    const traces = ['a', 'b', 'c', 'd'].map((id) => trace([], 'x', { traceId: id, requestId: id.toUpperCase() }));
    const checks = new Map([['a', failed('a')], ['b', failed('b')], ['c', passed('c')], ['d', failed('d')]]);
    const signals = new Map([
      ['a', { behaviors: ['skipped_policy_check', 'missed_required_escalation'] as const }],
      ['b', { behaviors: ['skipped_policy_check'] as const }],
      ['c', { behaviors: ['skipped_policy_check', 'checked_eligibility'] as const }],
      ['d', { behaviors: ['checked_eligibility'] as const }],
    ]) as never;
    const groups = groupFailures(traces, checks, signals);
    expect(groups.map((g) => [g.behavior, g.count])).toEqual([
      ['skipped_policy_check', 2],
      ['missed_required_escalation', 1],
    ]);
    expect(groups[0]!.share).toBe(0.5);
    expect(groups[0]!.traces[0]).toMatchObject({ requestId: 'A', reason: 'reason a' });
  });

  it('ignores traces the analyst has not tagged', () => {
    expect(groupFailures([trace([], 'x', { traceId: 'z' })], new Map([['z', failed('z')]]), new Map())).toEqual([]);
  });
});

describe('prompt edits', () => {
  const prompt = 'Line one.\nReturns: 30 days for everything.\nLine three.';

  it('applies find/replace edits and appends', () => {
    const out = applyEdits(prompt, [
      { find: 'Returns: 30 days for everything.', replace: 'Returns: check eligibility first.', reason: 'stale', evidenceRequestIds: ['S03'] },
      { find: '', replace: 'Escalate when a tool says so.', reason: 'missing', evidenceRequestIds: ['S08'] },
    ]);
    expect(out).toBe('Line one.\nReturns: check eligibility first.\nLine three.\nEscalate when a tool says so.');
  });

  it('rejects edits that do not match exactly once', () => {
    expect(() => applyEdits(prompt, [{ find: 'not in prompt', replace: 'x', reason: 'r here', evidenceRequestIds: ['S1'] }])).toThrow(EditError);
    expect(() => applyEdits('a a', [{ find: 'a', replace: 'b', reason: 'r here', evidenceRequestIds: ['S1'] }])).toThrow(/2 times/);
  });

  it('keeps $ signs literal in replacements', () => {
    expect(applyEdits('fee', [{ find: 'fee', replace: 'fee of $& and $1', reason: 'money', evidenceRequestIds: ['S1'] }])).toBe('fee of $& and $1');
  });

  it('diffs by line', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('validates learner output against the schema', () => {
    expect(learnerOutputSchema.safeParse({ summary: 'short summary', edits: [] }).success).toBe(false);
    expect(learnerOutputSchema.safeParse({ summary: 'short summary', edits: [{ find: 'x', replace: 'y', reason: 'because', evidenceRequestIds: [] }] }).success).toBe(false);
  });
});

describe('eval case schema', () => {
  const ok = { title: 'A case', kind: 'variant', input: 'I want to return my order ORD-20512', must: ['Checks eligibility'], mustNot: [], expectedToolPath: ['mcp__store__check_return_eligibility'], sourceRequestIds: ['S03'] };
  it('accepts full tool names only', () => {
    expect(evalCaseSchema.safeParse(ok).success).toBe(true);
    expect(evalCaseSchema.safeParse({ ...ok, expectedToolPath: ['check_return_eligibility'] }).success).toBe(false);
    expect(evalCaseSchema.safeParse({ ...ok, must: [] }).success).toBe(false);
  });
});

describe('gate verdict', () => {
  const score = (judge: number | null, trajectory: number | null = null, error: string | null = null): ItemScore => ({ judge, judgeReason: 'r', trajectory, toolPath: [], error, latencyMs: 1000, costUsd: 0.01, traceId: null, reply: '' });
  const items: GateItem[] = [
    { itemId: 'g1', title: 'Golden one', input: 'x', golden: true, expectedToolPath: ['mcp__store__lookup_order'] },
    { itemId: 'a1', title: 'Autoeval one', input: 'y', golden: false, expectedToolPath: ['mcp__store__check_return_eligibility'] },
    { itemId: 'a2', title: 'Autoeval two', input: 'z', golden: false, expectedToolPath: [] },
  ];
  const run = (base: Record<string, ItemScore>, cand: Record<string, ItemScore>) => computeVerdict(items, new Map(Object.entries(base)), new Map(Object.entries(cand)), { base: 'v1', candidate: 'v2' });

  it('a case passes only with a passing judge and, if it has one, a full tool path', () => {
    expect(itemPassed(items[0]!, score(1, 1))).toBe(true);
    expect(itemPassed(items[0]!, score(1, 0.5))).toBe(false);
    expect(itemPassed(items[2]!, score(1, null))).toBe(true);
    expect(itemPassed(items[2]!, score(1, null, 'boom'))).toBe(false);
  });

  it('passes when the candidate fixes cases and keeps the golden set', () => {
    const report = run({ g1: score(1, 1), a1: score(0, 0.5), a2: score(0) }, { g1: score(1, 1), a1: score(1, 1), a2: score(1) });
    expect(report.passed).toBe(true);
    expect(report.rows.map((r) => r.status)).toEqual(['still_passing', 'fixed', 'fixed']);
    expect(report.candidate).toMatchObject({ passed: 3, total: 3, avgLatencyMs: 1000 });
  });

  it('fails on a golden regression even with a net gain', () => {
    const report = run({ g1: score(1, 1), a1: score(0, 0), a2: score(0) }, { g1: score(0, 1), a1: score(1, 1), a2: score(1) });
    expect(report.rules.find((r) => r.id === 'golden_holds')?.passed).toBe(false);
    expect(report.rules.find((r) => r.id === 'net_improvement')?.passed).toBe(true);
    expect(report.passed).toBe(false);
  });

  it('fails when any expected tool path is below 1.0 on the candidate', () => {
    const report = run({ g1: score(1, 1), a1: score(0, 0), a2: score(0) }, { g1: score(1, 1), a1: score(1, 0.5), a2: score(1) });
    expect(report.rules.find((r) => r.id === 'tool_paths')).toMatchObject({ passed: false });
    expect(report.passed).toBe(false);
  });

  it('fails without a net improvement, and treats missing results as failures', () => {
    const report = run({ g1: score(1, 1), a1: score(1, 1), a2: score(1) }, { g1: score(1, 1), a1: score(1, 1) });
    expect(report.rows[2]!.status).toBe('regressed');
    expect(report.rules.find((r) => r.id === 'net_improvement')?.passed).toBe(false);
  });
});
