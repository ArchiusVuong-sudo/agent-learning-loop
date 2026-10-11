import { Telescope } from 'lucide-react';
import Link from 'next/link';
import { JobButton, JobProgress } from '@/components/client';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardHeader, EmptyState, PassDot, Stat, cn } from '@/components/ui';
import { getChecks } from '@/lib/loop/checks';
import { getSignals, groupFailures } from '@/lib/loop/findings';
import { latestJobs } from '@/lib/loop/jobs';
import { BEHAVIORS } from '@/lib/loop/prompts';
import { shellState } from '@/lib/loop/state';
import { listSupportTraces } from '@/lib/loop/traces';

export const dynamic = 'force-dynamic';

const outcomeTone = { resolved: 'good', refused_per_policy: 'neutral', escalated: 'info', unresolved: 'bad' } as const;

export default async function FindingsPage() {
  const [shell, traces, checks, signals, jobs] = await Promise.all([shellState(), listSupportTraces({ sources: ['seed', 'try'] }), getChecks(), getSignals(), latestJobs()]);
  const groups = groupFailures(traces, checks, signals);
  const untagged = traces.filter((t) => !signals.has(t.traceId)).length;
  const tagged = traces.filter((t) => signals.has(t.traceId));
  const failed = tagged.filter((t) => checks.get(t.traceId)?.passed === false).length;
  const analyzing = jobs.analyze?.status === 'running';

  return (
    <>
      <PageHeader
        step="Step 2"
        title="Findings"
        description="An analyst agent reads each trace and tags the customer's goal, the outcome and the behaviors it shows, as structured output checked against a schema. Failed traces group by behavior, so the loop works on patterns, not single chats."
      />
      <div className="space-y-5 px-8 py-6">
        <JobProgress kind="analyze" initial={jobs.analyze} label="Analyst agent tagging traces" />
        {!traces.length ? (
          <Card>
            <EmptyState icon={<Telescope className="h-5 w-5" />} title="Nothing to analyze yet" action={<Link href="/traces" className="text-sm font-medium text-indigo-600 hover:underline">Go to Traces</Link>}>
              Run the synthetic traffic first.
            </EmptyState>
          </Card>
        ) : (
          <>
            {untagged ? (
              <Card className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="text-sm text-slate-700">
                  <span className="font-semibold">{untagged} trace{untagged === 1 ? '' : 's'}</span> without signals yet. The analyst runs on {shell.models.analyst}.
                </div>
                <JobButton kind="analyze" label={`Analyze ${untagged} trace${untagged === 1 ? '' : 's'}`} initial={jobs.analyze} disabled={analyzing} />
              </Card>
            ) : null}
            <div className="grid grid-cols-4 gap-3">
              <Stat label="Traces analyzed" value={`${tagged.length}/${traces.length}`} />
              <Stat label="Failed online checks" value={failed} tone={failed ? 'bad' : 'good'} hint={tagged.length ? `${Math.round((failed / tagged.length) * 100)}% of analyzed` : undefined} />
              <Stat label="Failure groups" value={groups.length} hint="By negative behavior" />
              <Stat label="Largest group" value={groups[0]?.count ?? 0} hint={groups[0]?.label} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-5">
              <Card>
                <CardHeader title="Failure groups" subtitle="Failed traces by behavior. A trace can show more than one." right={<Badge tone="warn">LLM-generated</Badge>} />
                {groups.length ? (
                  <ul className="divide-y divide-slate-100">
                    {groups.map((group, index) => (
                      <li key={group.behavior} className="px-5 py-3.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                              {index === 0 ? <Badge tone="bad">Largest</Badge> : null}
                              {group.label}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">{group.behavior}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold tabular-nums text-slate-900">{group.count}</div>
                            <div className="text-[11px] text-slate-500">{Math.round(group.share * 100)}% of traces</div>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(4, group.share * 100)}%` }} />
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          {group.traces.slice(0, 8).map((t) => (
                            <Link key={t.traceId} href={`/traces#${t.traceId}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-indigo-50 hover:text-indigo-700" title={t.reason}>
                              {t.requestId?.startsWith('try-') ? 'try' : t.requestId}
                            </Link>
                          ))}
                          <Link href={`/evals?group=${group.behavior}`} className="ml-auto text-xs font-medium text-indigo-600 hover:underline">
                            Propose cases
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={tagged.length ? 'No failure groups' : 'Not analyzed yet'}>{tagged.length ? 'Every analyzed trace passed its online checks.' : 'Analyze the traces to see groups.'}</EmptyState>
                )}
              </Card>
              <Card>
                <CardHeader title="Trace signals" subtitle={`Goal, outcome and behaviors per trace, from the analyst agent (${shell.models.analyst}).`} right={<Badge tone="warn">LLM-generated</Badge>} />
                <div className="scroll-thin max-h-[640px] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white text-[11px] uppercase tracking-wide text-slate-400">
                      <tr className="border-b border-slate-100">
                        <th className="px-5 py-2 font-medium">Request</th>
                        <th className="py-2 font-medium">Goal</th>
                        <th className="py-2 font-medium">Outcome</th>
                        <th className="py-2 pr-5 font-medium">Behaviors</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {tagged.map((trace) => {
                        const signal = signals.get(trace.traceId)!;
                        const check = checks.get(trace.traceId);
                        return (
                          <tr key={trace.traceId} className="align-top">
                            <td className="px-5 py-2.5">
                              <Link href={`/traces#${trace.traceId}`} className="flex items-center gap-1.5 font-mono text-slate-600 hover:text-indigo-700">
                                <PassDot passed={check ? check.passed : null} />
                                {trace.requestId?.startsWith('try-') ? 'try' : trace.requestId}
                              </Link>
                            </td>
                            <td className="py-2.5 pr-3 text-slate-800">{signal.goal}</td>
                            <td className="py-2.5 pr-3">
                              <Badge tone={outcomeTone[signal.outcome]}>{signal.outcome.replaceAll('_', ' ')}</Badge>
                            </td>
                            <td className="py-2.5 pr-5">
                              <div className="flex flex-wrap gap-1">
                                {signal.behaviors.map((b) => (
                                  <span key={b} className={cn('rounded px-1.5 py-0.5 text-[11px]', BEHAVIORS[b]?.negative ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>
                                    {BEHAVIORS[b]?.label ?? b}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
