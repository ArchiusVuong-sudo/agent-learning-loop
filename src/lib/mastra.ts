import { mkdirSync } from 'node:fs';
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { MastraStorageExporter, Observability } from '@mastra/observability';
import { createAgents, type Agents } from './agents';
import { config, dataPath } from './config';
import { createScorers } from './loop/scorers';

function build() {
  mkdirSync(config.dataDir, { recursive: true });
  const agents = createAgents();
  const scorers = createScorers();
  const exporter = new MastraStorageExporter({ strategy: 'realtime' });
  const mastra = new Mastra({
    agents,
    scorers,
    storage: new LibSQLStore({ id: 'loop-store', url: `file:${dataPath('mastra.db')}` }),
    observability: new Observability({
      configs: { default: { serviceName: 'agent-learning-loop', exporters: [exporter] } },
    }),
    logger: false,
  });
  return { mastra, agents, scorers, exporter };
}

type MastraBundle = ReturnType<typeof build>;
const globalForMastra = globalThis as unknown as { __mastra?: MastraBundle };

/** One Mastra instance per process (kept on globalThis so dev reloads do not duplicate it). */
export function getMastra(): MastraBundle {
  globalForMastra.__mastra ??= build();
  return globalForMastra.__mastra;
}

export function agents(): Agents {
  return getMastra().agents;
}

/** Waits until every buffered span reached storage, so reads right after a run see it. */
export async function flushTraces(): Promise<void> {
  await getMastra().exporter.flush();
}

export async function observabilityStore() {
  const store = await getMastra().mastra.getStorage()?.getStore('observability');
  if (!store) throw new Error('Mastra storage has no observability domain');
  return store;
}
