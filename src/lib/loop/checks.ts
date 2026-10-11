import { z } from 'zod';
import { all, json, num, one, run, str } from '../db';
import { agents } from '../mastra';
import type { TraceView } from './traces';

export interface RuleResult {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

const named = (view: TraceView, short: string) => view.toolCalls.filter((c) => c.shortName === short);
const orderIdOf = (value: unknown) => (value && typeof value === 'object' && 'orderId' in value ? String((value as { orderId: unknown }).orderId).toUpperCase() : null);
const ELIGIBILITY_TALK = /\b\d+[- ]day|return window|\beligible\b|can be returned|you can return|restocking/i;

/** Deterministic span rules. They read only the trace, so they are cheap and exact. */
export function spanRules(view: TraceView): RuleResult[] {
  const errors = view.toolCalls.filter((c) => c.isError);
  const returns = named(view, 'create_return');
  const checked = new Set(named(view, 'check_return_eligibility').map((c) => orderIdOf(c.input)));
  const unchecked = returns.filter((c) => !checked.has(orderIdOf(c.input)));
  const policyEvidence = named(view, 'search_policy').length + named(view, 'check_return_eligibility').length;
  const needsHuman = named(view, 'check_return_eligibility').some((c) => (c.output as { requiresEscalation?: boolean } | null)?.requiresEscalation === true);
  const escalated = named(view, 'escalate_to_human').some((c) => !c.isError);

  return [
    {
      id: 'tool_errors',
      label: 'Tool calls succeeded',
      passed: errors.length === 0,
      detail: errors.length ? `${errors.map((c) => c.shortName).join(', ')} returned an error: ${String(errors[0]?.output ?? '').slice(0, 160)}` : 'No tool errors.',
    },
    {
      id: 'eligibility_before_return',
      label: 'Eligibility checked before a return',
      passed: unchecked.length === 0,
      detail: unchecked.length ? `create_return ran for ${unchecked.map((c) => orderIdOf(c.input)).join(', ')} without check_return_eligibility first.` : returns.length ? 'Every return was checked first.' : 'No returns created.',
    },
    {
      id: 'policy_grounding',
      label: 'Policy claims backed by a policy or eligibility lookup',
      passed: !ELIGIBILITY_TALK.test(view.reply) || policyEvidence > 0,
      detail: ELIGIBILITY_TALK.test(view.reply)
        ? policyEvidence > 0
          ? 'The reply talks about windows or eligibility and the trace has a policy or eligibility lookup.'
          : 'The reply talks about return windows or eligibility, but the agent never looked up policy or eligibility.'
        : 'The reply makes no window or eligibility claim.',
    },
    {
      id: 'required_escalation',
      label: 'Escalated when a tool said a human must decide',
      passed: !needsHuman || escalated,
      detail: needsHuman ? (escalated ? 'Escalated as required.' : 'check_return_eligibility returned requiresEscalation, but the agent did not escalate.') : 'No tool asked for escalation.',
    },
  ];
}

export const judgeVerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  reason: z.string().min(1).max(600),
  issues: z
    .array(
      z.object({
        kind: z.enum(['unsupported_claim', 'contradicts_tool_result', 'missed_escalation', 'unauthorized_promise', 'missing_fee_or_condition', 'other']),
        detail: z.string().max(300),
      }),
    )
    .max(5),
});
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

const clip = (value: unknown, max = 900) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

/** Renders a trace as plain text for a judge or analyst. Request ids stay; trace ids do not. */
export function renderTrace(view: Pick<TraceView, 'input' | 'reply' | 'toolCalls'>): string {
  const calls = view.toolCalls.length
    ? view.toolCalls.map((c, i) => `${i + 1}. ${c.name}(${clip(c.input, 300)}) -> ${c.isError ? 'ERROR ' : ''}${clip(c.output)}`).join('\n')
    : '(no tool calls)';
  return `Customer message:\n${view.input}\n\nTool calls:\n${calls}\n\nAgent reply:\n${view.reply}`;
}

export async function judgeTrace(view: TraceView): Promise<JudgeVerdict> {
  const output = (await agents().onlineJudge.generate(renderTrace(view), {
    structuredOutput: { schema: judgeVerdictSchema },
    tracingOptions: { metadata: { source: 'judge', judgedTraceId: view.traceId, requestId: view.requestId } },
  })) as { object: JudgeVerdict };
  return output.object;
}

export interface CheckResult {
  traceId: string;
  passed: boolean;
  rules: RuleResult[];
  judge: JudgeVerdict;
}

/** Online checks for one trace: span rules plus the grounded-reply judge. Saved by trace id. */
export async function checkTrace(view: TraceView): Promise<CheckResult> {
  const rules = spanRules(view);
  const judge = view.error ? { verdict: 'fail' as const, reason: `The run failed: ${view.error}`, issues: [] } : await judgeTrace(view);
  const passed = rules.every((r) => r.passed) && judge.verdict === 'pass';
  await run(
    `INSERT INTO trace_checks (trace_id, request_id, source, prompt_version, passed, rules, judge, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trace_id) DO UPDATE SET passed = excluded.passed, rules = excluded.rules, judge = excluded.judge`,
    [view.traceId, view.requestId ?? '', String(view.source), view.promptVersion ?? '', passed ? 1 : 0, JSON.stringify(rules), JSON.stringify(judge), new Date().toISOString()],
  );
  return { traceId: view.traceId, passed, rules, judge };
}

const toCheck = (row: Record<string, unknown>): CheckResult => ({
  traceId: str(row.trace_id),
  passed: num(row.passed) === 1,
  rules: json<RuleResult[]>(row.rules, []),
  judge: json<JudgeVerdict>(row.judge, { verdict: 'fail', reason: 'missing', issues: [] }),
});

export async function getChecks(): Promise<Map<string, CheckResult>> {
  const rows = await all('SELECT * FROM trace_checks', [], toCheck);
  return new Map(rows.map((r) => [r.traceId, r]));
}

export async function getCheck(traceId: string): Promise<CheckResult | null> {
  return one('SELECT * FROM trace_checks WHERE trace_id = ?', [traceId], toCheck);
}
