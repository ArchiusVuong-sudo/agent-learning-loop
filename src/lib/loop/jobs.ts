import { randomUUID } from 'node:crypto';
import { all, num, one, run, str } from '../db';

export type JobKind = 'seed' | 'analyze' | 'gate' | 'shadow';

export interface Job {
  id: string;
  kind: JobKind;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  message: string;
  error: string | null;
  ref: string | null;
  createdAt: string;
  updatedAt: string;
}

const toJob = (row: Record<string, unknown>): Job => ({
  id: str(row.id),
  kind: str(row.kind) as JobKind,
  status: str(row.status) as Job['status'],
  done: num(row.done),
  total: num(row.total),
  message: str(row.message),
  error: row.error ? str(row.error) : null,
  ref: row.ref ? str(row.ref) : null,
  createdAt: str(row.created_at),
  updatedAt: str(row.updated_at),
});

export interface JobHandle {
  id: string;
  progress(done: number, message?: string): Promise<void>;
  setTotal(total: number): Promise<void>;
  setRef(ref: string): Promise<void>;
}

const globalForJobs = globalThis as unknown as { __jobs?: Map<string, Promise<void>> };
const running = (globalForJobs.__jobs ??= new Map<string, Promise<void>>());

/**
 * Starts long work (many CLI subprocesses) in the server process and returns at once.
 * The UI polls the job row. One job per kind at a time.
 */
export async function startJob(kind: JobKind, total: number, work: (job: JobHandle) => Promise<string | void>): Promise<Job> {
  const active = await one("SELECT * FROM jobs WHERE kind = ? AND status = 'running'", [kind], toJob);
  if (active && running.has(active.id)) return active;
  if (active) await run("UPDATE jobs SET status = 'error', error = 'Interrupted by a server restart' WHERE id = ?", [active.id]);

  const id = randomUUID();
  const now = new Date().toISOString();
  await run('INSERT INTO jobs (id, kind, status, done, total, message, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)', [id, kind, 'running', total, 'Starting', now, now]);
  const handle: JobHandle = {
    id,
    progress: (done, message) => run('UPDATE jobs SET done = ?, message = COALESCE(?, message), updated_at = ? WHERE id = ?', [done, message ?? null, new Date().toISOString(), id]).then(() => undefined),
    setTotal: (t) => run('UPDATE jobs SET total = ? WHERE id = ?', [t, id]).then(() => undefined),
    setRef: (ref) => run('UPDATE jobs SET ref = ? WHERE id = ?', [ref, id]).then(() => undefined),
  };
  const promise = (async () => {
    try {
      const message = await work(handle);
      await run("UPDATE jobs SET status = 'done', message = ?, updated_at = ? WHERE id = ?", [message ?? 'Done', new Date().toISOString(), id]);
    } catch (error) {
      console.error(`[job ${kind}]`, error);
      await run("UPDATE jobs SET status = 'error', error = ?, updated_at = ? WHERE id = ?", [error instanceof Error ? error.message : String(error), new Date().toISOString(), id]);
    } finally {
      running.delete(id);
    }
  })();
  running.set(id, promise);
  return (await getJob(id))!;
}

export async function getJob(id: string): Promise<Job | null> {
  return one('SELECT * FROM jobs WHERE id = ?', [id], toJob);
}

export async function latestJobs(): Promise<Record<string, Job>> {
  const rows = await all('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50', [], toJob);
  const latest: Record<string, Job> = {};
  for (const job of rows) latest[job.kind] ??= job;
  return latest;
}

/** Lets scripts wait for a job they started in-process. */
export async function waitForJob(id: string): Promise<Job> {
  await running.get(id);
  return (await getJob(id))!;
}
