import { Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { ReviewButtons, SuggestButtons } from '@/components/suggestion-actions';
import { Badge, Card, CardHeader, EmptyState, Notice, cn } from '@/components/ui';
import { latestGate } from '@/lib/loop/gate';
import { shellState } from '@/lib/loop/state';
import { latestSuggestion, lineDiff } from '@/lib/loop/suggestions';
import { getVersion, listVersions } from '@/lib/loop/versions';

export const dynamic = 'force-dynamic';

export default async function SuggestionPage() {
  const [shell, suggestion, gate, versions] = await Promise.all([shellState(), latestSuggestion(), latestGate(), listVersions()]);
  const base = suggestion ? await getVersion(suggestion.baseVersion) : null;
  const diff = suggestion && base ? lineDiff(base.text, suggestion.proposedText) : [];
  const canRevise = !!gate && gate.status === 'failed' && gate.candidateVersion === shell.candidate?.id;
  const nextVersion = `v${versions.length + 1}`;
  const added = diff.filter((d) => d.kind === 'added').length;
  const removed = diff.filter((d) => d.kind === 'removed').length;

  return (
    <>
      <PageHeader
        step="Step 4"
        title="Suggestion"
        description="A learner agent proposes the smallest prompt change that fixes the failure groups without breaking the golden set. Each edit names its reason and the requests behind it. Approving saves a candidate; live traffic stays on the live version."
        actions={<SuggestButtons canSuggest={shell.counts.tagged > 0} canRevise={canRevise} hasSuggestion={!!suggestion} />}
      />
      <div className="space-y-5 px-8 py-6">
        {canRevise ? <Notice tone="warn">The gate failed for {gate?.candidateVersion}. Revise sends its failing rows back to the learner, so the next candidate keeps the fixes and avoids those failures.</Notice> : null}
        {!suggestion ? (
          <Card>
            <EmptyState icon={<Lightbulb className="h-5 w-5" />} title="No suggestion yet">
              {shell.counts.added ? 'Ask the learner for a fix. It reads the failure groups, the judge reasons and every dataset case.' : <>Add approved cases on the <Link href="/evals" className="text-indigo-600 hover:underline">Autoevals</Link> page first, so the learner knows what the fix must pass.</>}
            </EmptyState>
          </Card>
        ) : (
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5">
            <Card>
              <CardHeader
                title={`Prompt diff: ${suggestion.baseVersion} to ${suggestion.candidateVersion ?? 'proposed'}`}
                subtitle={<span><span className="text-emerald-700">+{added}</span> / <span className="text-rose-700">-{removed}</span> lines. {suggestion.summary}</span>}
                right={
                  suggestion.status === 'proposed' ? (
                    <ReviewButtons id={suggestion.id} nextVersion={nextVersion} />
                  ) : (
                    <Badge tone={suggestion.status === 'approved' ? 'good' : 'bad'}>{suggestion.status === 'approved' ? `Saved as candidate ${suggestion.candidateVersion}` : 'Rejected'}</Badge>
                  )
                }
              />
              <div className="scroll-thin max-h-[640px] overflow-auto py-2 font-mono text-[12px] leading-relaxed">
                {diff.map((line, i) => (
                  <div key={i} className={cn('flex gap-3 px-5', line.kind === 'added' && 'bg-emerald-50 text-emerald-900', line.kind === 'removed' && 'bg-rose-50 text-rose-900 line-through decoration-rose-300', line.kind === 'same' && 'text-slate-600')}>
                    <span className="w-3 shrink-0 select-none text-slate-400">{line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}</span>
                    <span className="whitespace-pre-wrap">{line.text || ' '}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <CardHeader title={`${suggestion.edits.length} edit${suggestion.edits.length === 1 ? '' : 's'}, with evidence`} subtitle={`From the learner (${shell.models.learner}). Each edit replaced exactly one span of the prompt, checked before saving.`} right={<Badge tone="warn">LLM-generated</Badge>} />
              <ol className="divide-y divide-slate-100">
                {suggestion.edits.map((edit, i) => (
                  <li key={i} className="px-5 py-3.5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-50 text-indigo-700">{i + 1}</span>
                      {edit.find ? 'Replace' : 'Append'}
                    </div>
                    <p className="mt-1.5 text-sm text-slate-800">{edit.reason}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                      Evidence:
                      {edit.evidenceRequestIds.map((id) => (
                        <Link key={id} href={`/traces#${id}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">
                          {id.startsWith('try-') ? 'try' : id}
                        </Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
              {suggestion.status === 'approved' ? (
                <div className="border-t border-slate-100 px-5 py-3 text-sm">
                  <Link href="/gate" className="font-medium text-indigo-600 hover:underline">Run the gate on {suggestion.candidateVersion}</Link>
                </div>
              ) : null}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
