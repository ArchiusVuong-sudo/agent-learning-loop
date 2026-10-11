import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { config } from '../config';
import { LiveProvider } from './live';
import { ReplayProvider } from './replay';
import type { LlmProvider, ProviderMode } from './types';

export * from './types';

export interface ProviderStatus {
  mode: ProviderMode;
  reason: string;
}

/** Finds a usable credential without printing or reading its value. */
export function detectCredentials(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY is set';
  const home = process.env.HOME ?? homedir();
  if (existsSync(path.join(home, '.claude', '.credentials.json'))) return 'Claude Code login found';
  if (process.platform === 'darwin') {
    const probe = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials'], { stdio: 'ignore' });
    if (probe.status === 0) return 'Claude Code login found in the keychain';
  }
  return null;
}

export function resolveMode(): ProviderStatus {
  if (config.forceReplay) return { mode: 'replay', reason: 'DEMO_REPLAY=1' };
  const credential = detectCredentials();
  if (!credential) return { mode: 'replay', reason: 'No Claude Code login or ANTHROPIC_API_KEY found' };
  return { mode: 'live', reason: credential };
}

const globalForProvider = globalThis as unknown as { __llmProvider?: { provider: LlmProvider; status: ProviderStatus } };

export function getProvider(): LlmProvider {
  return providerState().provider;
}

export function providerStatus(): ProviderStatus {
  return providerState().status;
}

function providerState(): { provider: LlmProvider; status: ProviderStatus } {
  if (!globalForProvider.__llmProvider) {
    const status = resolveMode();
    const provider = status.mode === 'live' ? new LiveProvider() : new ReplayProvider(config.fixturesDir);
    globalForProvider.__llmProvider = { provider, status };
  }
  return globalForProvider.__llmProvider;
}

/** Test hook: swap the provider (for example a replay provider over a temp fixtures folder). */
export function setProvider(provider: LlmProvider, reason = 'set by caller'): void {
  globalForProvider.__llmProvider = { provider, status: { mode: provider.mode, reason } };
}
