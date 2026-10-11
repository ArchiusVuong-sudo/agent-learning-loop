import { describe, expect, it } from 'vitest';
import { all, str } from '@/lib/db';
import { SUPPORT_PROMPT_V1 } from '@/lib/loop/prompts';
import { candidateVersion, createCandidate, liveVersion, listVersions, setLive } from '@/lib/loop/versions';

describe('prompt versions', () => {
  it('starts with v1 live, saves a candidate without touching live, then promotes and rolls back with audit rows', async () => {
    expect((await liveVersion()).text).toBe(SUPPORT_PROMPT_V1);
    const v2 = await createCandidate('new prompt', 'v1', 'sugg-1', 'fix');
    expect(v2).toMatchObject({ id: 'v2', status: 'candidate', parentId: 'v1' });
    expect((await liveVersion()).id).toBe('v1');

    await setLive('v2', 'promote');
    expect((await liveVersion()).id).toBe('v2');
    expect(await candidateVersion()).toBeNull();
    expect((await listVersions()).find((v) => v.id === 'v1')?.status).toBe('retired');

    await setLive('v1', 'rollback');
    expect((await liveVersion()).id).toBe('v1');
    expect((await candidateVersion())?.id).toBe('v2');

    const actions = await all('SELECT action FROM audit_log ORDER BY id', [], (r) => str(r.action));
    expect(actions).toEqual(['candidate_saved', 'promote', 'rollback']);
  });

  it('marks a candidate replaced by a newer one as superseded, not retired', async () => {
    const first = await createCandidate('candidate a', 'v1', 'sugg-a', 'a');
    const second = await createCandidate('candidate b', 'v1', 'sugg-b', 'b');
    const versions = await listVersions();
    expect(versions.find((v) => v.id === first.id)?.status).toBe('superseded');
    expect(versions.find((v) => v.id === second.id)?.status).toBe('candidate');
    expect((await candidateVersion())?.id).toBe(second.id);
  });

  it('keeps exactly one live version', async () => {
    const live = (await listVersions()).filter((v) => v.status === 'live');
    expect(live).toHaveLength(1);
  });
});
