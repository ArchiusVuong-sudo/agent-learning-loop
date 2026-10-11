import { z } from 'zod';
import { config } from '../config';
import { all, json, run, str } from '../db';
import { agents } from '../mastra';
import { getChecks, renderTrace, type CheckResult } from './checks';
import { BEHAVIOR_IDS, BEHAVIORS, NEGATIVE_BEHAVIORS, type Behavior } from './prompts';
import type { TraceView } from './traces';

export const OUTCOMES = ['resolved', 'refused_per_policy', 'escalated', 'unresolved'] as const;

export const signalSchema = z.object({
  goal: z.string().min(2).max(80).describe('What the customer wanted, in a few words'),
  outcome: z.enum(OUTCOMES),
  behaviors: z.array(z.enum(BEHAVIOR_IDS as [Behavior, ...Behavior[]])).min(1).max(4),
  summary: z.string().min(5).max(240).describe('One sentence on what the agent did'),
});
export type Signal = z.infer<typeof signalSchema>;

export interface StoredSignal extends Signal {
  traceId: string;
  model: string;
}

function analystPrompt(view: TraceView, check: CheckResult | undefined): string {
  const checks = check
    ? `Online checks: ${check.passed ? 'passed' : 'failed'}. ${check.rules.filter((r) => !r.passed).map((r) => r.detail).join(' ')} Judge: ${check.judge.reason}`
    : 'Online checks: not run.';
  const list = BEHAVIOR_IDS.map((id) => `- ${id}: ${BEHAVIORS[id].label}`).join('\n');
  return `${renderTrace(view)}\n\n${checks}\n\nBehaviors to choose from:\n${list}`;
}

export async function analyzeTrace(view: TraceView, check: CheckResult | undefined): Promise<Signal> {
  const out = (await agents().analyst.generate(analystPrompt(view, check), {
    structuredOutput: { schema: signalSchema },
    tracingOptions: { metadata: { source: 'analyst', analyzedTraceId: view.traceId, requestId: view.requestId } },
  })) as { object: Signal };
  const signal = out.object;
  await run(
    `INSERT INTO trace_signals (trace_id, goal, outcome, behaviors, summary, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trace_id) DO UPDATE SET goal = excluded.goal, outcome = excluded.outcome, behaviors = excluded.behaviors, summary = excluded.summary`,
    [view.traceId, signal.goal, signal.outcome, JSON.stringify(signal.behaviors), signal.summary, config.models.analyst, new Date().toISOString()],
  );
  return signal;
}

export async function getSignals(): Promise<Map<string, StoredSignal>> {
  const rows = await all('SELECT * FROM trace_signals', [], (row) => ({
    traceId: str(row.trace_id),
    goal: str(row.goal),
    outcome: str(row.outcome) as Signal['outcome'],
    behaviors: json<Behavior[]>(row.behaviors, []),
    summary: str(row.summary),
    model: str(row.model),
  }));
  return new Map(rows.map((r) => [r.traceId, r]));
}

export interface GroupTrace {
  traceId: string;
  requestId: string | null;
  input: string;
  reply: string;
  /** The full trace as text, tool calls included, for the eval author and learner. */
  rendered: string;
  reason: string;
}

export interface FailureGroup {
  behavior: Behavior;
  label: string;
  count: number;
  /** Share of all analyzed traces. */
  share: number;
  traces: GroupTrace[];
}

/**
 * Groups failed traces by negative behavior. A trace can sit in more than one group. Pure, so
 * the grouping rules are unit tested.
 */
export function groupFailures(traces: TraceView[], checks: Map<string, CheckResult>, signals: Map<string, Pick<StoredSignal, 'behaviors'>>): FailureGroup[] {
  const analyzed = traces.filter((t) => signals.has(t.traceId));
  const groups = new Map<Behavior, GroupTrace[]>();
  for (const trace of analyzed) {
    const check = checks.get(trace.traceId);
    if (!check || check.passed) continue;
    const reason = [check.judge.verdict === 'fail' ? check.judge.reason : '', ...check.rules.filter((r) => !r.passed).map((r) => r.detail)].filter(Boolean).join(' ');
    for (const behavior of signals.get(trace.traceId)!.behaviors) {
      if (!NEGATIVE_BEHAVIORS.includes(behavior)) continue;
      const list = groups.get(behavior) ?? [];
      list.push({ traceId: trace.traceId, requestId: trace.requestId, input: trace.input, reply: trace.reply, rendered: renderTrace(trace), reason });
      groups.set(behavior, list);
    }
  }
  return [...groups.entries()]
    .map(([behavior, list]) => ({ behavior, label: BEHAVIORS[behavior].label, count: list.length, share: analyzed.length ? list.length / analyzed.length : 0, traces: list }))
    .sort((a, b) => b.count - a.count || a.behavior.localeCompare(b.behavior));
}

export async function currentFailureGroups(traces: TraceView[]): Promise<FailureGroup[]> {
  const [checks, signals] = await Promise.all([getChecks(), getSignals()]);
  return groupFailures(traces, checks, signals);
}
