/**
 * Headless runs of the loop.
 *
 *   pnpm seed     synthetic traffic on the live prompt, online checks, analyst tags
 *   pnpm record   the whole main flow live, recording every model response into fixtures/
 *   pnpm reset    delete the local databases in data/
 *
 * `record` needs the Claude Code login (or ANTHROPIC_API_KEY) and takes a few minutes.
 */
import { existsSync, rmSync } from 'node:fs';
import { config } from '../src/lib/config';
import { closeDb } from '../src/lib/db';
import { providerStatus } from '../src/lib/llm';
import { waitForJob } from '../src/lib/loop/jobs';
import { ensureSetup, startAnalysis, startSeedTraffic } from '../src/lib/loop/pipeline';
import { runWalkthrough } from '../src/lib/loop/walkthrough';
import { flushTraces } from '../src/lib/mastra';

const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`);

async function main() {
  const command = process.argv[2];
  log(`mode: ${providerStatus().mode} (${providerStatus().reason})`);
  if (command === 'reset') {
    if (existsSync(config.dataDir)) rmSync(config.dataDir, { recursive: true, force: true });
    log(`removed ${config.dataDir}`);
  } else if (command === 'seed') {
    await ensureSetup();
    for (const start of [startSeedTraffic, startAnalysis]) {
      const job = await waitForJob((await start()).id);
      if (job.status === 'error') throw new Error(job.error ?? 'job failed');
      log(`${job.kind}: ${job.message}`);
    }
  } else if (command === 'record') {
    if (providerStatus().mode !== 'live') throw new Error(`record needs live mode (${providerStatus().reason})`);
    if (!config.recordFixtures) throw new Error('Run with RECORD_FIXTURES=1 (pnpm record sets it)');
    if (existsSync(config.dataDir)) throw new Error(`Record into an empty data folder: ${config.dataDir} exists (pnpm reset, or set DATA_DIR)`);
    const result = await runWalkthrough(log);
    log(`gates: ${result.gates.map((g) => `${g.candidateVersion} ${g.status}`).join(', ')}; shadow: ${JSON.stringify(result.shadow)}`);
    log(`fixtures written to ${config.fixturesDir}`);
  } else {
    throw new Error('Usage: tsx scripts/loop.ts <seed|record|reset>');
  }
  await flushTraces();
  await closeDb();
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
