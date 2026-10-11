import { describe, expect, it } from 'vitest';
import { config } from '@/lib/config';
import { providerStatus } from '@/lib/llm';
import { runSupport } from '@/lib/loop/runner';
import { seedStore } from '@/lib/store/repo';

/** Opt-in: LIVE=1 pnpm test:live. Runs one real query on the local Claude Code login. */
describe.skipIf(process.env.LIVE !== '1')('live smoke test', () => {
  it('answers through the SDK with only the store tools, traced and checked', async () => {
    expect(providerStatus().mode).toBe('live');
    await seedStore(config.storeToday);
    const out = await runSupport('Lena Fischer here. Has my order ORD-20755 shipped yet?', { source: 'try', requestId: 'live-smoke', promptVersion: 'v1' });
    expect(out.trace.replayed).toBe(false);
    expect(out.trace.reply.length).toBeGreaterThan(10);
    expect(out.trace.toolCalls.every((c) => c.name.startsWith('mcp__store__'))).toBe(true);
    expect(out.check.rules).toHaveLength(4);
  }, 180_000);
});
