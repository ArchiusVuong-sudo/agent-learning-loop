'use client';

import { Check, FlaskConical, Plus, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { CaseProposal, EvalCase } from '@/lib/loop/autoevals';
import { ActionError, postJson, useAction } from './client';
import { Badge, Button, Card, CardHeader, EmptyState, Spinner, cn, shortTool } from './ui';

export interface GroupOption {
  behavior: string;
  label: string;
  count: number;
}

function LineList({ label, tone, lines, onChange, disabled }: { label: string; tone: 'good' | 'bad'; lines: string[]; onChange: (lines: string[]) => void; disabled: boolean }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={cn('text-[11px] font-semibold uppercase tracking-wide', tone === 'good' ? 'text-emerald-700' : 'text-rose-700')}>{label}</span>
        {!disabled ? (
          <button type="button" onClick={() => onChange([...lines, ''])} className="flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-indigo-600">
            <Plus className="h-3 w-3" /> line
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        {lines.length === 0 ? <div className="text-xs text-slate-400">(none)</div> : null}
        {lines.map((line, i) => (
          <div key={i} className="group flex items-start gap-1">
            <textarea
              rows={1}
              value={line}
              disabled={disabled}
              onChange={(event) => onChange(lines.map((l, j) => (j === i ? event.target.value : l)))}
              className={cn('field-sizing-content min-h-7 flex-1 resize-none rounded-md border px-2 py-1 text-xs leading-snug text-slate-800 outline-none focus:border-indigo-400 disabled:bg-transparent', tone === 'good' ? 'border-emerald-100 bg-emerald-50/40' : 'border-rose-100 bg-rose-50/40', disabled && 'border-transparent')}
              aria-label={`${label} line ${i + 1}`}
            />
            {!disabled ? (
              <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} className="mt-1.5 text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100" aria-label="Remove line">
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function CaseCard({ proposal }: { proposal: CaseProposal }) {
  const [draft, setDraft] = useState<EvalCase>(proposal.body);
  const dirty = JSON.stringify(draft) !== JSON.stringify(proposal.body);
  const { run, busy, error } = useAction();
  const locked = proposal.status === 'added';
  const save = (status: 'approved' | 'rejected' | 'proposed') =>
    run(() => postJson(`/api/cases/${proposal.id}`, { status, body: { ...draft, must: draft.must.filter(Boolean), mustNot: draft.mustNot.filter(Boolean) } }, 'PATCH'));

  return (
    <Card className={cn('flex flex-col p-4 transition-shadow', proposal.status === 'approved' && 'ring-2 ring-emerald-400', proposal.status === 'rejected' && 'opacity-55', locked && 'ring-1 ring-indigo-200')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge tone={draft.kind === 'from_trace' ? 'info' : 'brand'}>{draft.kind === 'from_trace' ? 'From trace' : 'Reworded variant'}</Badge>
            {proposal.status === 'approved' ? <Badge tone="good">Approved</Badge> : null}
            {proposal.status === 'rejected' ? <Badge tone="bad">Rejected</Badge> : null}
            {locked ? <Badge tone="brand">In dataset v{proposal.datasetVersion}</Badge> : null}
            {dirty ? <Badge tone="warn">Edited</Badge> : null}
          </div>
          <h3 className="mt-1.5 text-sm font-semibold text-slate-900">{draft.title}</h3>
        </div>
      </div>
      <label className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Input</label>
      <textarea
        value={draft.input}
        disabled={locked}
        onChange={(event) => setDraft({ ...draft, input: event.target.value })}
        rows={3}
        className="field-sizing-content mt-1 min-h-16 resize-none rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs leading-relaxed text-slate-800 outline-none focus:border-indigo-400 disabled:bg-transparent"
      />
      <div className="mt-3 space-y-2.5">
        <LineList label="Must" tone="good" lines={draft.must} disabled={locked} onChange={(must) => setDraft({ ...draft, must })} />
        <LineList label="Must not" tone="bad" lines={draft.mustNot} disabled={locked} onChange={(mustNot) => setDraft({ ...draft, mustNot })} />
      </div>
      <div className="mt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expected tool path</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {draft.expectedToolPath.length ? (
            draft.expectedToolPath.map((name, i) => (
              <span key={i} className="flex items-center gap-1">
                {i ? <span className="text-slate-300">&rarr;</span> : null}
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-800 ring-1 ring-amber-200" title={name}>
                  {shortTool(name)}
                  {!locked ? (
                    <button type="button" onClick={() => setDraft({ ...draft, expectedToolPath: draft.expectedToolPath.filter((_, j) => j !== i) })} className="text-amber-500 hover:text-rose-600" aria-label={`Remove ${shortTool(name)} from the path`}>
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ) : null}
                </span>
              </span>
            ))
          ) : (
            <span className="text-xs text-slate-400">No path check</span>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
        Source:
        {draft.sourceRequestIds.map((id) => (
          <Link key={id} href={`/traces#${id}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-slate-700 hover:bg-indigo-50 hover:text-indigo-700">
            {id}
          </Link>
        ))}
      </div>
      {!locked ? (
        <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" variant={proposal.status === 'approved' ? 'good' : 'secondary'} disabled={busy} onClick={() => save(proposal.status === 'approved' && !dirty ? 'proposed' : 'approved')}>
            {busy ? <Spinner /> : <Check className="h-3 w-3" />} {proposal.status === 'approved' && !dirty ? 'Approved' : dirty ? 'Save and approve' : 'Approve'}
          </Button>
          <Button size="sm" variant={proposal.status === 'rejected' ? 'danger' : 'ghost'} disabled={busy} onClick={() => save(proposal.status === 'rejected' ? 'proposed' : 'rejected')}>
            <X className="h-3 w-3" /> {proposal.status === 'rejected' ? 'Rejected' : 'Reject'}
          </Button>
        </div>
      ) : null}
      {error ? <div className="mt-2"><ActionError error={error} /></div> : null}
    </Card>
  );
}

export function CaseBoard({ groups, selected, proposals, authorModel }: { groups: GroupOption[]; selected: string | null; proposals: CaseProposal[]; authorModel: string }) {
  const router = useRouter();
  const propose = useAction();
  const add = useAction();
  const current = groups.find((g) => g.behavior === selected) ?? groups[0];
  const cards = proposals.filter((p) => p.behavior === current?.behavior);
  const approved = proposals.filter((p) => p.status === 'approved').length;

  if (!current) {
    return (
      <Card>
        <EmptyState icon={<FlaskConical className="h-5 w-5" />} title="No failure groups yet">
          Analyze traces on the Findings page first. Cases are drafted from failing traces.
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Draft cases from a failure group"
        subtitle={`The eval author (${authorModel}) copies failing messages and writes reworded variants with must, mustNot and the tool path a correct agent takes.`}
        right={<Badge tone="warn">LLM-generated, needs a person</Badge>}
      />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-5 py-3">
        {groups.map((g) => (
          <button
            key={g.behavior}
            type="button"
            onClick={() => router.replace(`/evals?group=${g.behavior}`, { scroll: false })}
            className={cn('rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset', g.behavior === current.behavior ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50')}
          >
            {g.label} <span className="ml-1 opacity-70">{g.count}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button variant={cards.length ? 'secondary' : 'primary'} disabled={propose.busy} onClick={() => propose.run(() => postJson('/api/cases/propose', { behavior: current.behavior }))}>
            {propose.busy ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" />}
            {propose.busy ? 'Drafting cases' : cards.length ? 'Draft again' : 'Propose cases'}
          </Button>
        </div>
      </div>
      <div className="px-5 py-4">
        <ActionError error={propose.error} />
        {cards.length ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {cards.map((p) => (
              <CaseCard key={`${p.id}-${p.status}`} proposal={p} />
            ))}
          </div>
        ) : propose.busy ? (
          <div className="grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-72 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        ) : (
          <EmptyState title={`No cases drafted for "${current.label}"`}>Propose cases to draft 3 or 4 from the {current.count} failing traces in this group.</EmptyState>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
        <div className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{approved}</span> approved case{approved === 1 ? '' : 's'} waiting. Rejected cases are never added.
        </div>
        <div className="flex items-center gap-3">
          <ActionError error={add.error} />
          <Button disabled={!approved || add.busy} onClick={() => add.run(() => postJson('/api/cases/add'))}>
            {add.busy ? <Spinner /> : <Plus className="h-3.5 w-3.5" />} Add {approved || ''} to dataset
          </Button>
        </div>
      </div>
    </Card>
  );
}
