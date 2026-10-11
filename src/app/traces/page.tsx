import { Activity } from 'lucide-react';
import { JobButton, JobProgress } from '@/components/client';
import { PageHeader } from '@/components/page-header';
import { TraceList } from '@/components/trace-list';
import { TryBox } from '@/components/try-box';
import { Card, CardHeader, EmptyState, Stat, usd } from '@/components/ui';
import { getChecks } from '@/lib/loop/checks';
import { latestJobs } from '@/lib/loop/jobs';
import { listSupportTraces } from '@/lib/loop/traces';
import { SEED_TRAFFIC, TRY_SUGGESTIONS } from '@/lib/loop/traffic';
import { shellState } from '@/lib/loop/state';

export const dynamic = 'force-dynamic';

export default async function TracesPage() {
  const [shell, traces, checks, jobs] = await Promise.all([shellState(), listSupportTraces({ sources: ['seed', 'try'] }), getChecks(), latestJobs()]);
  const rows = traces.map((trace) => ({ trace, check: checks.get(trace.traceId) ?? null }));
  // Stats count only traces whose run and checks finished, so a running batch never shows 0%.
  const checked = rows.filter((r) => r.check);
  const failing = checked.filter((r) => !r.check!.passed).length;
  const avgLatency = checked.length ? checked.reduce((s, r) => s + (r.trace.durationMs ?? 0), 0) / checked.length : 0;
  const cost = checked.reduce((s, r) => s + r.trace.costUsd, 0);
  const seedRunning = jobs.seed?.status === 'running';

  return (
    <>
      <PageHeader
        step="Step 1"
        title="Traces"
        description="Every support-agent run is a Mastra trace: the agent run, the model call and each store tool call with its args and result. Online checks (span rules plus a grounded-reply judge) flag the failures."
      />
      <div className="space-y-5 px-8 py-6">
        <Card className="p-4">
          <TryBox suggestions={TRY_SUGGESTIONS} liveVersion={shell.live.id} replay={shell.mode === 'replay'} />
        </Card>
        <JobProgress kind="seed" initial={jobs.seed} label={`Synthetic traffic: ${SEED_TRAFFIC.length} requests on prompt ${shell.live.id}`} />
        {traces.length ? (
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Traces" value={traces.length} hint="Synthetic traffic and Try box" />
            <Stat label="Failed a check" value={failing} tone={failing ? 'bad' : checked.length ? 'good' : undefined} hint={checked.length ? `${Math.round((failing / checked.length) * 100)}% of ${checked.length} checked` : 'Checks running'} />
            <Stat label="Avg latency" value={checked.length ? `${(avgLatency / 1000).toFixed(1)} s` : '-'} hint={shell.mode === 'replay' ? 'Agent run, as recorded live' : 'Agent run, one CLI subprocess each'} />
            <Stat label="SDK cost estimate" value={checked.length ? usd(cost) : '-'} hint={shell.mode === 'replay' ? 'As recorded' : 'Sum over these runs'} />
          </div>
        ) : null}
        <Card>
          <CardHeader
            title="Support agent traces"
            subtitle={`Filtered to entity support-agent and sources seed and try, so judge and helper agent runs never count. Agent model: ${shell.models.support}, judge: ${shell.models.judge}.`}
            right={traces.length ? <JobButton kind="seed" label="Run traffic again" variant="secondary" initial={jobs.seed} /> : null}
          />
          {rows.length ? (
            <TraceList rows={rows} />
          ) : (
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title={seedRunning ? 'Traffic is running' : 'No traces yet'}
              action={<JobButton kind="seed" label={`Run synthetic traffic (${SEED_TRAFFIC.length} requests)`} initial={jobs.seed} />}
            >
              Send {SEED_TRAFFIC.length} synthetic customer requests through the support agent on prompt {shell.live.id}. Each run becomes a trace with its tool calls and online check results.
            </EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
