import { Database } from 'lucide-react';
import { CaseBoard } from '@/components/case-board';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardHeader, shortTool } from '@/components/ui';
import { datasetSummary, listProposals } from '@/lib/loop/autoevals';
import { currentFailureGroups } from '@/lib/loop/findings';
import { shellState } from '@/lib/loop/state';
import { listSupportTraces } from '@/lib/loop/traces';

export const dynamic = 'force-dynamic';

export default async function EvalsPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  const { group } = await searchParams;
  const [shell, traces, proposals, dataset] = await Promise.all([shellState(), listSupportTraces({ sources: ['seed', 'try'] }), listProposals(), datasetSummary()]);
  const groups = await currentFailureGroups(traces);

  return (
    <>
      <PageHeader
        step="Step 3"
        title="Autoevals"
        description="Turn a failure group into regression cases. A person edits, approves or rejects each one; approved cases join the hand-written golden set as a new version of the Mastra dataset."
      />
      <div className="space-y-5 px-8 py-6">
        <CaseBoard groups={groups.map((g) => ({ behavior: g.behavior, label: g.label, count: g.count }))} selected={group ?? null} proposals={proposals} authorModel={shell.models.author} />
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-400" /> Mastra dataset: {dataset.name}
              </span>
            }
            subtitle="Versioned by Mastra: every batch of added cases bumps the version, and the gate pins one version for both experiments."
            right={<Badge tone="brand">Version {dataset.version}</Badge>}
          />
          <table className="w-full text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-slate-400">
              <tr className="border-b border-slate-100">
                <th className="px-5 py-2 font-medium">Case</th>
                <th className="py-2 font-medium">Must</th>
                <th className="py-2 font-medium">Tool path</th>
                <th className="py-2 pr-5 text-right font-medium">Added in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dataset.items.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="max-w-md px-5 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {item.metadata.golden ? <Badge tone="neutral">Golden</Badge> : <Badge tone="brand">Autoeval</Badge>}
                      <span className="font-medium text-slate-800">{item.metadata.title}</span>
                    </div>
                    <div className="mt-1 text-slate-500">{item.input}</div>
                  </td>
                  <td className="max-w-sm py-2.5 pr-3 text-slate-600">{item.groundTruth.must.join(' / ')}</td>
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-600">{item.expectedToolPath.map(shortTool).join(' > ') || '-'}</td>
                  <td className="py-2.5 pr-5 text-right tabular-nums text-slate-500">v{item.datasetVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
