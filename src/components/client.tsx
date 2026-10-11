'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { Job } from '@/lib/loop/jobs';
import { Button, Spinner, cn } from './ui';

export async function postJson<T = unknown>(url: string, payload?: unknown, method = 'POST'): Promise<T> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload) });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Runs a mutation, then refreshes the server components. Tracks busy and error state. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const value = await fn();
        startTransition(() => router.refresh());
        return value;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [router],
  );
  return { run, busy, error, setError };
}

export function ActionError({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>;
}

/** A button that starts a background job, then shows its progress until it ends. */
export function JobButton({ kind, label, initial, disabled, variant = 'primary', hint }: { kind: string; label: string; initial?: Job | null; disabled?: boolean; variant?: 'primary' | 'secondary'; hint?: string }) {
  const { run, busy, error } = useAction();
  const running = initial?.status === 'running';
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant={variant} disabled={disabled || busy || running} onClick={() => run(() => postJson<Job>(`/api/jobs/${kind}`))} title={hint}>
        {busy || running ? <Spinner /> : null}
        {label}
      </Button>
      {error ? <div className="max-w-sm text-right text-xs text-rose-600">{error}</div> : null}
    </div>
  );
}

/** Polls the job table while a job of this kind runs, then refreshes the page once. */
export function JobProgress({ kind, initial, label }: { kind: string; initial: Job | null | undefined; label: string }) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(initial ?? null);
  const wasRunning = useRef(initial?.status === 'running');

  useEffect(() => {
    setJob(initial ?? null);
    if (initial?.status === 'running') wasRunning.current = true;
  }, [initial]);

  useEffect(() => {
    if (job?.status !== 'running') return;
    const timer = setInterval(async () => {
      const res = await fetch('/api/jobs', { cache: 'no-store' });
      if (!res.ok) return;
      const latest = ((await res.json()) as Record<string, Job>)[kind];
      if (!latest) return;
      setJob(latest);
      if (latest.status !== 'running' && wasRunning.current) {
        wasRunning.current = false;
        router.refresh();
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [job?.status, kind, router]);

  if (!job) return null;
  if (job.status === 'done' && !wasRunning.current && Date.now() - new Date(job.updatedAt).getTime() > 15_000) return null;
  const pct = job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : job.status === 'done' ? 100 : 5;
  return (
    <div className={cn('rounded-xl border px-4 py-3', job.status === 'error' ? 'border-rose-200 bg-rose-50' : 'border-indigo-100 bg-white')}>
      <div className="flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-slate-800">
          {job.status === 'running' ? <Spinner className="text-indigo-600" /> : null}
          {label}
        </div>
        <div className={cn('text-xs tabular-nums', job.status === 'error' ? 'text-rose-700' : 'text-slate-500')}>{job.status === 'error' ? job.error : job.message}</div>
      </div>
      {job.status !== 'error' ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className={cn('h-full rounded-full transition-all duration-500', job.status === 'running' ? 'progress-live' : 'bg-emerald-500')} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
