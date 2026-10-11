import path from 'node:path';

/** Every agent role in the loop. Only `support` serves customers; the rest are helpers. */
export type AgentRole = 'support' | 'judge' | 'analyst' | 'author' | 'learner';

const env = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
};

const root = process.env.APP_ROOT ?? process.cwd();

export const config = {
  root,
  dataDir: env('DATA_DIR', path.join(root, 'data')),
  fixturesDir: env('FIXTURES_DIR', path.join(root, 'fixtures')),
  /** The judge runs on a different model than the agent it grades. */
  models: {
    support: env('AGENT_MODEL', 'claude-haiku-5-5'),
    judge: env('JUDGE_MODEL', 'claude-opus-5-5'),
    analyst: env('ANALYST_MODEL', 'claude-sonnet-5-5'),
    author: env('AUTHOR_MODEL', 'claude-opus-5-5'),
    learner: env('LEARNER_MODEL', 'claude-opus-5-5'),
  } satisfies Record<AgentRole, string>,
  maxTurns: {
    support: 8,
    judge: 2,
    analyst: 2,
    author: 2,
    learner: 2,
  } satisfies Record<AgentRole, number>,
  /** Upper bound on CLI subprocesses running at once, across the whole app. */
  maxConcurrentRuns: Number(env('MAX_CONCURRENT_RUNS', '6')),
  /** Fixed "today" for the synthetic store, so return windows do not drift. */
  storeToday: env('STORE_TODAY', '2026-10-01'),
  forceReplay: process.env.DEMO_REPLAY === '1',
  recordFixtures: process.env.RECORD_FIXTURES === '1',
} as const;

export function dataPath(file: string): string {
  return path.join(config.dataDir, file);
}
