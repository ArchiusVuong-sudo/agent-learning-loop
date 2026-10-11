import { Rocket } from 'lucide-react';
import Link from 'next/link';
import { JobButton, JobProgress } from '@/components/client';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardHeader, EmptyState, Notice, PassDot, Stat, cn, secs, usd } from '@/components/ui';
import { PromoteButton } from '@/components/version-actions';
import { latestGate } from '@/lib/loop/gate';
import { latestJobs } from '@/lib/loop/jobs';
import { passedGateForCandidate, shadowPairs } from '@/lib/loop/rollout';
import { shellState } from '@/lib/loop/state';
import { HELD_OUT_TRAFFIC } from '@/lib/loop/traffic';

export const dynamic = 'force-dynamic';

export default async function RolloutPage() {
  const [shell, ready, gate, jobs] = await Promise.all([shellState(), passedGateForCandidate(), latestGate(), latestJobs()]);
  const pairs = gate ? await shadowPairs(gate.id) : [];
  const ran = pairs.filter((p) => p.live || p.shadow);
  const livePass = ran.filter((p) => p.live?.passed).length;
  const shadowPass = ran.filter((p) => p.shadow?.passed).length;
  const avg = (key: 'live' | 'shadow') => {
    const values = ran.map((p) => p[key]?.latencyMs).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const cost = (key: 'live' | 'shadow') => ran.reduce((s, p) => s + (p[key]?.costUsd ?? 0), 0);
  const shadowVersion = ran.find((p) => p.shadow)?.shadow?.version ?? ready?.candidate.id ?? '-';
  const liveVersion = ran.find((p) => p.live)?.live?.version ?? shell.live.id;
  const shadowDone = jobs.shadow?.status === 'done' && ran.length === HELD_OUT_TRAFFIC.length;

  return (
    <>
      <PageHeader
        step="Step 6"
        title="Rollout"
        description={`Held-out synthetic traffic (${HELD_OUT_TRAFFIC.length} requests the eval author and learner never saw) runs on the live prompt and, in shadow, on the candidate, with the same online checks. Promote flips the live version; every step writes an audit row and one click rolls back.`}
        actions={
          ready ? (
            <div className="flex items-start gap-2">
              <JobButton kind="shadow" label={ran.length ? 'Run shadow again' : 'Start shadow run'} variant={shadowDone ? 'secondary' : 'primary'} initial={jobs.shadow} />
              <PromoteButton candidate={ready.candidate.id} disabled={jobs.shadow?.status === 'running'} />
            </div>
          ) : null
        }
      />
      <div className="space-y-5 px-8 py-6">
        {!ready ? (
          shell.live.id !== 'v1' && !shell.candidate ? (
            <Notice>
              {shell.live.id} is live. See <Link href="/versions" className="font-medium underline">Versions</Link> for the audit log and roll back.
            </Notice>
          ) : (
            <Card>
              <EmptyState icon={<Rocket className="h-5 w-5" />} title="Locked until a gate passes">
                The shadow run and Promote unlock when the current candidate passes the <Link href="/gate" className="text-indigo-600 hover:underline">gate</Link>.
              </EmptyState>
            </Card>
          )
        ) : null}
        <JobProgress kind="shadow" initial={jobs.shadow} label={`Shadow run: ${HELD_OUT_TRAFFIC.length} held-out requests on ${liveVersion} and ${shadowVersion}`} />
        {ran.length ? (
          <>
            <div className="grid grid-cols-4 gap-3">
              <Stat label={`Live ${liveVersion} passed`} value={`${livePass}/${ran.length}`} tone={livePass === ran.length ? 'good' : 'bad'} hint="Online checks" />
              <Stat label={`Shadow ${shadowVersion} passed`} value={`${shadowPass}/${ran.length}`} tone={shadowPass >= livePass ? 'good' : 'bad'} hint="Same checks, same requests" />
              <Stat label="Avg latency" value={`${secs(avg('live'))} / ${secs(avg('shadow'))}`} hint={`${liveVersion} / ${shadowVersion}`} />
              <Stat label="SDK cost estimate" value={`${usd(cost('live'))} / ${usd(cost('shadow'))}`} hint={`${liveVersion} / ${shadowVersion}`} />
            </div>
            <Card>
              <CardHeader title="Paired results" subtitle="Customers would only see the live reply. The shadow reply is checked and logged." right={<Badge tone="neutral">Held-out, synthetic</Badge>} />
              <table className="w-full text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                  <tr className="border-b border-slate-100">
                    <th className="px-5 py-2 font-medium">Request</th>
                    <th className="py-2 font-medium">Live {liveVersion}</th>
                    <th className="py-2 pr-5 font-medium">Shadow {shadowVersion}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pairs.map((pair) => (
                    <tr key={pair.requestId} className="align-top">
                      <td className="max-w-xs px-5 py-2.5">
                        <div className="font-mono text-[11px] text-slate-500">{pair.requestId}</div>
                        <div className="text-slate-800">{pair.message}</div>
                      </td>
                      {(['live', 'shadow'] as const).map((key) => {
                        const r = pair[key];
                        return (
                          <td key={key} className={cn('max-w-sm py-2.5 pr-5')}>
                            {r ? (
                              <Link href={`/traces/${r.traceId}`} className="block rounded-lg p-1.5 hover:bg-slate-50">
                                <div className="flex items-center gap-1.5 font-medium">
                                  <PassDot passed={r.passed} />
                                  <span className={r.passed ? 'text-emerald-700' : 'text-rose-700'}>{r.passed ? 'Passed' : 'Failed'}</span>
                                  <span className="ml-auto tabular-nums text-slate-400">{secs(r.latencyMs)}</span>
                                </div>
                                {!r.passed ? <div className="mt-0.5 line-clamp-2 text-slate-600">{r.reason}</div> : null}
                              </Link>
                            ) : (
                              <span className="text-slate-400">Waiting</span>
                            )}
                          </td>
                        );
                      })}
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
