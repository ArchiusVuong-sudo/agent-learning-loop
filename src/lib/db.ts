import { mkdirSync } from 'node:fs';
import { createClient, type Client, type InArgs, type Row } from '@libsql/client';
import { config, dataPath } from './config';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tier TEXT NOT NULL,
  member_since TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  sku TEXT NOT NULL,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  ordered_on TEXT NOT NULL,
  delivered_on TEXT,
  status TEXT NOT NULL,
  opened INTEGER NOT NULL DEFAULT 0,
  final_sale INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  keywords TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS returns (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  reason TEXT NOT NULL,
  refund_cents INTEGER NOT NULL,
  fee_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  order_id TEXT,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('live', 'candidate', 'retired', 'superseded')),
  parent_id TEXT,
  suggestion_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trace_checks (
  trace_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  source TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  passed INTEGER NOT NULL,
  rules TEXT NOT NULL,
  judge TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trace_signals (
  trace_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  outcome TEXT NOT NULL,
  behaviors TEXT NOT NULL,
  summary TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_proposals (
  id TEXT PRIMARY KEY,
  behavior TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'added')),
  body TEXT NOT NULL,
  dataset_item_id TEXT,
  dataset_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestions (
  id TEXT PRIMARY KEY,
  base_version TEXT NOT NULL,
  proposed_text TEXT NOT NULL,
  edits TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  candidate_version TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gates (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  dataset_version INTEGER NOT NULL,
  base_version TEXT NOT NULL,
  candidate_version TEXT NOT NULL,
  base_experiment_id TEXT,
  candidate_experiment_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'error')),
  report TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS shadow_results (
  id TEXT PRIMARY KEY,
  gate_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  version TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('live', 'shadow')),
  trace_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  reason TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error')),
  done INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error TEXT,
  ref TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as { __appDb?: Promise<Client> };

async function open(): Promise<Client> {
  mkdirSync(config.dataDir, { recursive: true });
  const client = createClient({ url: `file:${dataPath('app.db')}` });
  await client.execute('PRAGMA journal_mode = WAL');
  await client.execute('PRAGMA busy_timeout = 5000');
  await client.executeMultiple(SCHEMA);
  return client;
}

export function db(): Promise<Client> {
  globalForDb.__appDb ??= open();
  return globalForDb.__appDb;
}

export async function all<T>(sql: string, args: InArgs = [], map: (row: Row) => T): Promise<T[]> {
  const result = await (await db()).execute({ sql, args });
  return result.rows.map(map);
}

export async function one<T>(sql: string, args: InArgs = [], map: (row: Row) => T): Promise<T | null> {
  const rows = await all(sql, args, map);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InArgs = []): Promise<number> {
  const result = await (await db()).execute({ sql, args });
  return result.rowsAffected;
}

export const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
export const num = (value: unknown): number => Number(value ?? 0);
export const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export async function getState(key: string): Promise<string | null> {
  return one('SELECT value FROM app_state WHERE key = ?', [key], (row) => str(row.value));
}

export async function setState(key: string, value: string): Promise<void> {
  await run('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

export async function audit(actor: string, action: string, detail: Record<string, unknown>): Promise<void> {
  await run('INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)', [new Date().toISOString(), actor, action, JSON.stringify(detail)]);
}

/** Closes the connection (scripts and tests). */
export async function closeDb(): Promise<void> {
  const pending = globalForDb.__appDb;
  globalForDb.__appDb = undefined;
  if (pending) (await pending).close();
}
