'use client';

import { Activity, Check, FlaskConical, GitCompareArrows, History, Lightbulb, Lock, Rocket, Telescope } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { StepState } from '@/lib/loop/state';
import { cn } from './ui';

const STEPS = [
  { href: '/traces', key: 'traces', label: 'Traces', hint: 'Live runs and checks', icon: Activity },
  { href: '/findings', key: 'findings', label: 'Findings', hint: 'Signals and failure groups', icon: Telescope },
  { href: '/evals', key: 'evals', label: 'Autoevals', hint: 'Cases from failures', icon: FlaskConical },
  { href: '/suggestion', key: 'suggestion', label: 'Suggestion', hint: 'A minimal prompt fix', icon: Lightbulb },
  { href: '/gate', key: 'gate', label: 'Gate', hint: 'Two experiments, one verdict', icon: GitCompareArrows },
  { href: '/rollout', key: 'rollout', label: 'Rollout', hint: 'Shadow, promote, roll back', icon: Rocket },
] as const;

export function Sidebar({ steps, live, candidate }: { steps: Record<(typeof STEPS)[number]['key'], StepState>; live: string; candidate: string | null }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 pb-4 pt-5">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6" />
              <path d="M18 3v4h-4M6 21v-4h4" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Agent Learning Loop</div>
            <div className="text-[11px] leading-tight text-slate-500">Support agent, synthetic store</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        <div className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">The loop</div>
        {STEPS.map((step, index) => {
          const active = pathname.startsWith(step.href);
          const state = steps[step.key];
          const Icon = step.icon;
          return (
            <Link
              key={step.href}
              href={step.href}
              className={cn('group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors', active ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50')}
            >
              <span
                className={cn(
                  'grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold',
                  state === 'done' ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-indigo-600 text-white' : state === 'ready' ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400',
                )}
              >
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('flex items-center gap-1.5 text-sm font-medium', state === 'locked' && !active && 'text-slate-400')}>
                  <Icon className="h-3.5 w-3.5 opacity-70" />
                  {step.label}
                </span>
                <span className="block truncate text-[11px] text-slate-500">{step.hint}</span>
              </span>
              {state === 'locked' && !active ? <Lock className="h-3 w-3 text-slate-300" /> : null}
            </Link>
          );
        })}
        <div className="px-2 pb-1.5 pt-4 text-[11px] font-medium uppercase tracking-wide text-slate-400">Prompt</div>
        <Link href="/versions" className={cn('flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium', pathname.startsWith('/versions') ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700 hover:bg-slate-50')}>
          <span className="grid h-6 w-6 place-items-center rounded-md bg-slate-100 text-slate-600">
            <History className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1">Versions</span>
          <span className="rounded bg-emerald-50 px-1.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">{live} live</span>
        </Link>
        {candidate ? <div className="px-2 pl-11 text-[11px] text-slate-500">Candidate {candidate} waiting</div> : null}
      </nav>
      <div className="m-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
        <span className="font-semibold">Synthetic data.</span> Customers, orders and policies are made up. Every score on screen comes from this app&apos;s own runs.
      </div>
    </aside>
  );
}
