import { all, audit, db, one, run, str } from '../db';
import { SUPPORT_PROMPT_V1 } from './prompts';

export interface PromptVersion {
  id: string;
  text: string;
  status: 'live' | 'candidate' | 'retired';
  parentId: string | null;
  suggestionId: string | null;
  note: string;
  createdAt: string;
}

const toVersion = (row: Record<string, unknown>): PromptVersion => ({
  id: str(row.id),
  text: str(row.text),
  status: str(row.status) as PromptVersion['status'],
  parentId: row.parent_id ? str(row.parent_id) : null,
  suggestionId: row.suggestion_id ? str(row.suggestion_id) : null,
  note: str(row.note),
  createdAt: str(row.created_at),
});

export async function ensureBaseVersion(): Promise<void> {
  await run(
    `INSERT INTO prompt_versions (id, text, status, note, created_at) VALUES ('v1', ?, 'live', 'Initial prompt', ?) ON CONFLICT(id) DO NOTHING`,
    [SUPPORT_PROMPT_V1, new Date().toISOString()],
  );
}

export async function listVersions(): Promise<PromptVersion[]> {
  await ensureBaseVersion();
  return all('SELECT * FROM prompt_versions ORDER BY created_at, id', [], toVersion);
}

export async function getVersion(id: string): Promise<PromptVersion | null> {
  await ensureBaseVersion();
  return one('SELECT * FROM prompt_versions WHERE id = ?', [id], toVersion);
}

export async function liveVersion(): Promise<PromptVersion> {
  await ensureBaseVersion();
  const live = await one("SELECT * FROM prompt_versions WHERE status = 'live' LIMIT 1", [], toVersion);
  if (!live) throw new Error('No live prompt version');
  return live;
}

export async function candidateVersion(): Promise<PromptVersion | null> {
  await ensureBaseVersion();
  return one("SELECT * FROM prompt_versions WHERE status = 'candidate' ORDER BY created_at DESC LIMIT 1", [], toVersion);
}

/** Saves a new candidate. Live traffic keeps using the current live version. */
export async function createCandidate(text: string, parentId: string, suggestionId: string, note: string): Promise<PromptVersion> {
  const count = await one('SELECT COUNT(*) AS n FROM prompt_versions', [], (row) => Number(row.n));
  const id = `v${(count ?? 1) + 1}`;
  await run("UPDATE prompt_versions SET status = 'retired' WHERE status = 'candidate'");
  await run(`INSERT INTO prompt_versions (id, text, status, parent_id, suggestion_id, note, created_at) VALUES (?, ?, 'candidate', ?, ?, ?, ?)`, [
    id,
    text,
    parentId,
    suggestionId,
    note,
    new Date().toISOString(),
  ]);
  await audit('reviewer', 'candidate_saved', { version: id, parent: parentId, suggestion: suggestionId });
  return (await getVersion(id))!;
}

/**
 * Makes `id` the live version. On promote the old live version is retired (rollback still
 * reaches it through parent_id); on rollback the version we leave becomes the candidate again,
 * so it can be promoted once more without a new gate.
 */
export async function setLive(id: string, action: 'promote' | 'rollback', detail: Record<string, unknown> = {}): Promise<PromptVersion> {
  const target = await getVersion(id);
  if (!target) throw new Error(`Unknown prompt version ${id}`);
  const current = await liveVersion();
  if (current.id === id) return target;
  const client = await db();
  await client.batch(
    [
      { sql: "UPDATE prompt_versions SET status = 'retired' WHERE status = 'candidate'", args: [] },
      { sql: 'UPDATE prompt_versions SET status = ? WHERE id = ?', args: [action === 'rollback' ? 'candidate' : 'retired', current.id] },
      { sql: "UPDATE prompt_versions SET status = 'live' WHERE id = ?", args: [id] },
    ],
    'write',
  );
  await audit('reviewer', action, { from: current.id, to: id, ...detail });
  return (await getVersion(id))!;
}
