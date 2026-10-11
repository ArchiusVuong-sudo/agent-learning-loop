import { CheckCircle2, GitCompareArrows, XCircle } from 'lucide-react';
import Link from 'next/link';
import { JobButton, JobProgress } from '@/components/client';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardHeader, EmptyState, Notice, cn, secs, shortTool, usd } from '@/components/ui';
import { latestGate, type MatrixRow } from '@/lib/loop/gate';
import { latestJobs } from '@/lib/loop/jobs';
import { shellState } from '@/lib/loop/state';

export const dynamic = 'force-dynamic';

const statusBadge = {
  fixed: <Badge tone="good">Fixed</Badge>,
  regressed: <Badge tone="bad">Regressed</Badge>,
  still_passing: <Badge tone="neutral">Still passing</Badge>,
  still_failing: <Badge tone="warn">Still failing</Badge>,
} as const;

function Cell({ row, side }: { row: MatrixRow; side: 'base' | 'candidate' }) {
  const score = row[side];
  return (
    <div className="group relative">
      <div className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 ring-1 ring-inset', score.passed ? 'bg-emerald-50 ring-emerald-200' : 'bg-rose-50 ring-rose-200')}>
        {score.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}
        <div className="text-[11px] leading-tight">
          <div className={cn('font-semibold', score.passed ? 'text-emerald-800' : 'text-rose-800')}>{score.error ? 'Error' : score.passed ? 'Pass' : 'Fail'}</div>
          <div className="text-slate-500">
            judge {score.judge ?? '-'}
            {row.expectedToolPath.length ? ` / path ${score.trajectory === null ? '-' : score.trajectory.toFixed(2)}` : ''}
          </div>
        </div>
      </div>
      <div className={cn('pointer-events-none absolute top-full z-20', side === 'candidate' ? 'right-0' : 'left-0', 'mt-1 hidden w-96 rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl group-hover:block')}>
        <div className="font-semibold text-slate-800">Judge reason</div>
        <p className="mt-0.5 text-slate-600">{score.error ?? score.judgeReason}</p>
        <div className="mt-2 font-semibold text-slate-800">Tool path</div>
        <p className="mt-0.5 font-mono text-[11px] text-slate-600">{score.toolPath.map(shortTool).join(' > ') || '(no tools)'}</p>
        <div className="mt-2 flex gap-4 text-slate-500">
          <span>{secs(score.latencyMs)}</span>
          <span>{usd(score.costUsd)}</span>
        </div>
      </div>
    </div>
  );
}

export default async function GatePage() {
  const [shell, gate, jobs] = await Promise.all([shellState(), latestGate(), latestJobs()]);
  const report = gate?.report ?? null;
  const running = jobs.gate?.status === 'running';
  const candidate = shell.candidate;

  return (
    <>
      <PageHeader
        step="Step 5"
        title="Gate"
        description="Two Mastra experiments on the same pinned dataset version: the live prompt and the candidate, routed by requestContext. A Claude judge scorer checks must and mustNot, and Mastra's trajectory scorer reads the tool path from each trace. The app computes the verdict from both experiments' per-item scores."
        actions={<JobButton kind="gate" label={candidate ? `Run gate: ${shell.live.id} vs ${candidate.id}` : 'Run gate'} initial={jobs.gate} disabled={!candidate} hint={candidate ? undefined : 'Approve a suggestion first'} />}
      />
      <div className="space-y-5 px-8 py-6">
        <JobProgress kind="gate" initial={jobs.gate} label={`Experiments on dataset v${shell.counts.datasetVersion} (${shell.counts.datasetItems} cases, 2 versions)`} />
        {!candidate && !report ? (
          <Card>
            <EmptyState icon={<GitCompareArrows className="h-5 w-5" />} title="No candidate to gate">
              Approve a suggestion on the <Link href="/suggestion" className="text-indigo-600 hover:underline">Suggestion</Link> page. The gate compares it with the live prompt.
            </EmptyState>
          </Card>
        ) : null}
        {candidate && report && gate && gate.candidateVersion !== candidate.id && !running ? <Notice>Candidate {candidate.id} has not been gated yet. The last result below is for {gate.candidateVersion}.</Notice> : null}
        {gate?.status === 'error' ? <Notice tone="bad">The last gate stopped with an error: {gate.error}</Notice> : null}
        {report && gate ? (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5">
              <Card className={cn('overflow-hidden', report.passed ? 'ring-1 ring-emerald-200' : 'ring-1 ring-rose-200')}>
                <div className={cn('flex items-center gap-3 px-5 py-4', report.passed ? 'bg-emerald-50' : 'bg-rose-50')}>
                  {report.passed ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <XCircle className="h-7 w-7 text-rose-600" />}
                  <div>
                    <div className={cn('text-lg font-semibold', report.passed ? 'text-emerald-900' : 'text-rose-900')}>
                      Gate {report.passed ? 'passed' : 'failed'}: {gate.candidateVersion} vs {gate.baseVersion}
                    </div>
                    <div className="text-xs text-slate-600">
                      Dataset v{gate.datasetVersion}, pinned for both experiments. {report.passed ? 'The shadow run is unlocked.' : 'Revise the suggestion with these results, or edit the cases.'}
                    </div>
                  </div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {report.rules.map((rule) => (
                    <li key={rule.id} className="flex items-start gap-2.5 px-5 py-3">
                      {rule.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
                      <div>
                        <div className="text-sm font-medium text-slate-900">{rule.label}</div>
                        <div className="text-xs text-slate-500">{rule.detail}</div>
                      </div>
                    </li>
                  ))}
                </ul>
                {!report.passed && gate.candidateVersion === candidate?.id ? (
                  <div className="border-t border-slate-100 px-5 py-3 text-sm">
                    <Link href="/suggestion" className="font-medium text-indigo-600 hover:underline">Revise the suggestion from these results</Link>
                  </div>
                ) : null}
                {report.passed ? (
                  <div className="border-t border-slate-100 px-5 py-3 text-sm">
                    <Link href="/rollout" className="font-medium text-indigo-600 hover:underline">Continue to the shadow run</Link>
                  </div>
                ) : null}
              </Card>
              <Card>
                <CardHeader title="Per version" subtitle="Latency is the agent's model run per case as measured live; cost is the SDK's own estimate." />
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                    <tr className="border-b border-slate-100">
                      <th className="px-5 py-2 text-left font-medium">Version</th>
                      <th className="py-2 text-right font-medium">Cases passed</th>
                      <th className="py-2 text-right font-medium">Avg latency</th>
                      <th className="px-5 py-2 text-right font-medium">Cost (all cases)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    {[report.base, report.candidate].map((v, i) => (
                      <tr key={v.version}>
                        <td className="px-5 py-3">
                          <Badge tone={i ? 'brand' : 'neutral'}>{v.version}</Badge> <span className="ml-1 text-xs text-slate-500">{i ? 'candidate' : 'live'}</span>
                        </td>
                        <td className="py-3 text-right font-semibold">
                          {v.passed}/{v.total}
                          <div className="mx-0 ml-auto mt-1 h-1 w-24 overflow-hidden rounded-full bg-slate-100">
                            <div className={cn('h-full', i ? 'bg-indigo-500' : 'bg-slate-400')} style={{ width: `${(v.passed / Math.max(1, v.total)) * 100}%` }} />
                          </div>
                        </td>
                        <td className="py-3 text-right">{secs(v.avgLatencyMs)}</td>
                        <td className="px-5 py-3 text-right">{usd(v.totalCostUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="space-y-1 border-t border-slate-100 px-5 py-3 font-mono text-[11px] text-slate-500">
                  <div>experiment {gate.baseVersion}: {gate.baseExperimentId}</div>
                  <div>experiment {gate.candidateVersion}: {gate.candidateExperimentId}</div>
                </div>
              </Card>
            </div>
            <Card>
              <CardHeader title="Matrix" subtitle="Hover a cell for the judge reason and the tool path. A case passes when the judge passes it and its expected tool path, if any, scores 1.0." />
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2 font-medium">Case</th>
                    <th className="py-2 font-medium">Expected tool path</th>
                    <th className="w-40 py-2 font-medium">{gate.baseVersion}</th>
                    <th className="w-40 py-2 font-medium">{gate.candidateVersion}</th>
                    <th className="px-5 py-2 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.map((row) => (
                    <tr key={row.itemId} className="align-middle">
                      <td className="max-w-md px-5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          {row.golden ? <Badge tone="neutral">Golden</Badge> : <Badge tone="brand">Autoeval</Badge>}
                          <span className="font-medium text-slate-800">{row.title}</span>
                        </div>
                        <div className="mt-0.5 truncate text-slate-500">{row.input}</div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-600">{row.expectedToolPath.map(shortTool).join(' > ') || '-'}</td>
                      <td className="py-2.5 pr-3">
                        <Cell row={row} side="base" />
                      </td>
                      <td className="py-2.5 pr-3">
                        <Cell row={row} side="candidate" />
                      </td>
                      <td className="px-5 py-2.5 text-right">{statusBadge[row.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
