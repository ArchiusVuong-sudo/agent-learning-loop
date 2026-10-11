import { describe, expect, it } from 'vitest';
import { handle, replayMiss } from '@/lib/api';
import { LlmError } from '@/lib/llm/types';
import { getChecks } from '@/lib/loop/checks';
import { ensureSetup } from '@/lib/loop/pipeline';
import { runSupport } from '@/lib/loop/runner';
import { listSupportTraces } from '@/lib/loop/traces';

/** An error shaped like LlmError but from another module copy, as under `next start`. */
function foreignReplayMiss(message: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.name = 'LlmError';
  error.code = 'replay_miss';
  return error;
}

describe('replay miss mapping', () => {
  it('matches by class, by name and code, and through a cause chain', () => {
    expect(replayMiss(new LlmError('a', 'replay_miss'))?.message).toBe('a');
    expect(replayMiss(foreignReplayMiss('b'))?.message).toBe('b');
    expect(replayMiss(new Error('wrapped', { cause: foreignReplayMiss('c') }))?.message).toBe('c');
    expect(replayMiss(new LlmError('d', 'fatal'))).toBeNull();
    expect(replayMiss(new Error('e'))).toBeNull();
    expect(replayMiss('f')).toBeNull();
  });

  it('answers 422 for a replay miss from another module copy, 500 for other errors', async () => {
    const miss = await handle(async () => {
      throw foreignReplayMiss('not recorded');
    });
    expect(miss.status).toBe(422);
    expect(await miss.json()).toEqual({ error: 'not recorded', code: 'replay_miss' });
    const other = await handle(async () => {
      throw new Error('boom');
    });
    expect(other.status).toBe(500);
  });
});

describe('a support run that fails', () => {
  it('ends with a saved failed check instead of a trace that looks like it is still running', async () => {
    await ensureSetup();
    const message = 'A message nobody recorded, so replay mode has no answer for it.';
    await expect(runSupport(message, { source: 'try', requestId: 'try-v1-1', promptVersion: 'v1' })).rejects.toMatchObject({ code: 'replay_miss' });
    const trace = (await listSupportTraces({ sources: ['try'] })).find((t) => t.input === message);
    expect(trace?.error).toContain('Replay mode has no recorded');
    const check = (await getChecks()).get(trace!.traceId);
    expect(check?.passed).toBe(false);
    expect(check?.judge.reason).toContain('The run failed');
  });
});
