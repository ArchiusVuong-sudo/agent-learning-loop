import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardHeader, cn } from '@/components/ui';
import { RollbackButton } from '@/components/version-actions';
import { all, json, num, str } from '@/lib/db';
import { lineDiff } from '@/lib/loop/suggestions';
import { listVersions, liveVersion } from '@/lib/loop/versions';

export const dynamic = 'force-dynamic';

const statusTone = { live: 'good', candidate: 'brand', retired: 'neutral', superseded: 'neutral' } as const;

export default async function VersionsPage() {
  const [versions, live, auditRows] = await Promise.all([
    listVersions(),
    liveVersion(),
    all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 50', [], (row) => ({ id: num(row.id), at: str(row.at), actor: str(row.actor), action: str(row.action), detail: json<Record<string, unknown>>(row.detail, {}) })),
  ]);
  const byId = new Map(versions.map((v) => [v.id, v]));

  return (
    <>
      <PageHeader
        title="Prompt versions"
        description="App-owned versions of the support agent's system prompt. One is live and serves Try box and traffic runs; a candidate waits for the gate. Every approval, gate result, promotion and rollback is in the audit log."
        actions={live.parentId ? <RollbackButton target={live.parentId} /> : null}
      />
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 px-8 py-6">
        <div className="space-y-4">
          {[...versions].reverse().map((version) => {
            const parent = version.parentId ? byId.get(version.parentId) : null;
            const diff = parent ? lineDiff(parent.text, version.text) : [];
            return (
              <Card key={version.id} className={cn(version.status === 'live' && 'ring-2 ring-emerald-300')}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{version.id}</span>
                      <Badge tone={statusTone[version.status]}>{version.status}</Badge>
                      {version.id === live.parentId ? <Badge tone="neutral">roll back target</Badge> : null}
                    </span>
                  }
                  subtitle={`${version.parentId ? `From ${version.parentId}. ` : ''}${version.note} Created ${new Date(version.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.`}
                />
                <details className="group px-5 py-3" open={version.status === 'live'}>
                  <summary className="cursor-pointer select-none text-xs font-medium text-indigo-600">{parent ? `Show diff from ${parent.id}` : 'Show prompt'}</summary>
                  <div className="scroll-thin mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 py-2 font-mono text-[11px] leading-relaxed ring-1 ring-slate-200">
                    {(parent ? diff : version.text.split('\n').map((text) => ({ kind: 'same' as const, text }))).map((line, i) => (
                      <div key={i} className={cn('flex gap-2 px-3', line.kind === 'added' && 'bg-emerald-50 text-emerald-900', line.kind === 'removed' && 'bg-rose-50 text-rose-900', line.kind === 'same' && 'text-slate-600')}>
                        <span className="w-2 shrink-0 text-slate-400">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span>
                        <span className="whitespace-pre-wrap">{line.text || ' '}</span>
                      </div>
                    ))}
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
        <Card className="self-start">
          <CardHeader title="Audit log" subtitle="Newest first." />
          <ul className="divide-y divide-slate-100">
            {auditRows.length === 0 ? <li className="px-5 py-6 text-center text-sm text-slate-500">No actions yet.</li> : null}
            {auditRows.map((row) => (
              <li key={row.id} className="px-5 py-2.5 text-xs">
                <div className="flex items-center gap-2">
                  <Badge tone={row.action.includes('rollback') || row.action.endsWith('failed') ? 'bad' : row.action === 'promote' || row.action.endsWith('passed') ? 'good' : 'neutral'}>{row.action.replaceAll('_', ' ')}</Badge>
                  <span className="text-slate-500">{row.actor}</span>
                  <span className="ml-auto tabular-nums text-slate-400">{new Date(row.at).toLocaleTimeString('en-GB')}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">
                  {Object.entries(row.detail)
                    .map(([k, v]) => `${k}: ${typeof v === 'string' && v.length > 20 ? `${v.slice(0, 8)}` : String(v)}`)
                    .join('  ')}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
