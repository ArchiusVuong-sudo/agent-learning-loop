import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Each test file gets its own databases, and replay mode with no network and no waits.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'agent-loop-test-'));
process.env.DEMO_REPLAY = process.env.LIVE === '1' ? '' : '1';
process.env.REPLAY_DELAY_SCALE = '0';
delete process.env.RECORD_FIXTURES;

// Singletons live on globalThis; drop any left by a previous file in this worker.
const g = globalThis as Record<string, unknown>;
for (const key of ['__appDb', '__mastra', '__llmProvider', '__jobs', '__setup']) delete g[key];
