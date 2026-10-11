import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { anchorKey, fixtureFromResult, loadFixtures, requestKey, writeFixture } from '@/lib/llm/fixtures';
import { childEnv, isolatedOptions } from '@/lib/llm/live';
import { ReplayProvider } from '@/lib/llm/replay';
import { Semaphore, isRetryable, withRetry } from '@/lib/llm/retry';
import { LlmError, type LlmRequest, type LlmResult } from '@/lib/llm/types';
import { storeToolBelt } from '@/lib/store/tools';

const request = (patch: Partial<LlmRequest> = {}): LlmRequest => ({ role: 'judge', model: 'm', system: 'sys', prompt: 'hello', maxTurns: 2, anchor: 'hello', ...patch });
const result: LlmResult = {
  text: 'recorded reply',
  toolCalls: [{ id: 't1', name: 'mcp__store__lookup_order', input: { orderId: 'ORD-20512' }, output: { ok: true }, isError: false }],
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0.001,
  durationMs: 1000,
  model: 'm',
  replayed: false,
  attempts: 1,
};

describe('isolation of every SDK query', () => {
  it('turns off built-in tools, settings, MCP from disk and session files', () => {
    const options = isolatedOptions(request({ role: 'support', tools: storeToolBelt() }), '/tmp/sandbox');
    expect(options).toMatchObject({ tools: [], settingSources: [], strictMcpConfig: true, persistSession: false, permissionMode: 'dontAsk', skills: [], plugins: [], cwd: '/tmp/sandbox', maxTurns: 2 });
    expect(options.allowedTools).toHaveLength(6);
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['store']);
    expect(options.systemPrompt).toBe('sys');
  });

  it('gives helper agents no tools at all', () => {
    const options = isolatedOptions(request(), '/tmp/sandbox');
    expect(options.allowedTools).toEqual([]);
    expect(options.mcpServers).toEqual({});
  });

  it('builds the child env from an allowlist only', () => {
    const env = childEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', SECRET_TOKEN: 'nope', LANG: 'en' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', LANG: 'en' });
  });

  it('adds a JSON schema output format only when asked', () => {
    expect(isolatedOptions(request({ outputSchema: { type: 'object' } }), '/tmp/s').outputFormat).toEqual({ type: 'json_schema', schema: { type: 'object' } });
    expect(isolatedOptions(request(), '/tmp/s').outputFormat).toBeUndefined();
  });
});

describe('retry', () => {
  it('classifies overloaded, rate limit and 5xx as retryable', () => {
    for (const msg of ['529 overloaded_error', 'rate_limit exceeded', 'HTTP 503 Service Unavailable', 'Internal server error']) expect(isRetryable(new Error(msg))).toBe(true);
    for (const msg of ['invalid_request: bad schema', 'authentication_failed']) expect(isRetryable(new Error(msg))).toBe(false);
    expect(isRetryable(new LlmError('x', 'retryable'))).toBe(true);
    expect(isRetryable(new LlmError('x', 'replay_miss'))).toBe(false);
  });

  it('backs off and retries, then succeeds', async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('overloaded');
        return 'ok';
      },
      { attempts: 4, baseDelayMs: 100, maxDelayMs: 1000, sleep },
    );
    expect(out).toEqual({ value: 'ok', attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
    const [first, second] = sleep.mock.calls.map((c) => (c as unknown as [number])[0]);
    expect(first).toBeGreaterThanOrEqual(50);
    expect(second).toBeGreaterThanOrEqual(100);
  });

  it('does not retry fatal errors and gives up after the last attempt', async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(withRetry(async () => Promise.reject(new Error('invalid_request')), { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep })).rejects.toThrow('invalid_request');
    expect(sleep).not.toHaveBeenCalled();
    await expect(withRetry(async () => Promise.reject(new Error('overloaded')), { attempts: 2, baseDelayMs: 1, maxDelayMs: 1, sleep })).rejects.toThrow('overloaded');
  });

  it('caps concurrency', async () => {
    const gate = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 7 }, () =>
        gate.use(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(gate.inFlight).toBe(0);
  });
});

describe('fixtures and replay', () => {
  it('keys change with any part of the request', () => {
    expect(requestKey(request())).toBe(requestKey(request()));
    expect(requestKey(request({ system: 'other' }))).not.toBe(requestKey(request()));
    expect(requestKey(request({ outputSchema: { a: 1 } }))).not.toBe(requestKey(request()));
    expect(anchorKey(request({ system: 'other' }))).toBe(anchorKey(request()));
  });

  it('replays an exact match, falls back to the anchor, and refuses unknown requests', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fixtures-'));
    writeFixture(dir, fixtureFromResult(request(), result));
    expect(loadFixtures(dir).size).toBe(1);
    const replay = new ReplayProvider(dir, 0);
    const events: string[] = [];
    const exact = await replay.run(request(), { onToolCall: (c) => events.push(`call ${c.name}`), onToolResult: (r) => events.push(`result ${r.id}`) });
    expect(exact).toMatchObject({ text: 'recorded reply', replayed: true });
    expect(events).toEqual(['call mcp__store__lookup_order', 'result t1']);
    expect((await replay.run(request({ prompt: 'edited by a person' }))).text).toBe('recorded reply');
    await expect(replay.run(request({ anchor: 'never recorded', prompt: 'x' }))).rejects.toMatchObject({ code: 'replay_miss' });
  });

  it('serves repeated recordings of one request in recording order', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fixtures-'));
    writeFixture(dir, { ...fixtureFromResult(request(), { ...result, text: 'first' }), recordedAt: '2026-01-01T00:00:00.000Z' });
    writeFixture(dir, { ...fixtureFromResult(request(), { ...result, text: 'second' }), recordedAt: '2026-01-01T00:00:01.000Z' });
    const replay = new ReplayProvider(dir, 0);
    expect((await replay.run(request())).text).toBe('first');
    expect((await replay.run(request())).text).toBe('second');
    expect((await replay.run(request())).text).toBe('second');
  });

  it('ships fixtures recorded from live runs for every agent role', () => {
    const index = loadFixtures(path.join(process.cwd(), 'fixtures'));
    const roles = new Set([...index.byKey.values()].flat().map((f) => f.role));
    for (const role of ['support', 'judge', 'analyst', 'author', 'learner']) expect(roles.has(role)).toBe(true);
  });
});
