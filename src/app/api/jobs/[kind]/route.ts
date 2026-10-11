import { handle } from '@/lib/api';
import { startGate } from '@/lib/loop/gate';
import { startAnalysis, startSeedTraffic } from '@/lib/loop/pipeline';
import { startShadowRun } from '@/lib/loop/rollout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const starters = { seed: startSeedTraffic, analyze: startAnalysis, gate: startGate, shadow: startShadowRun } as const;

export async function POST(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  return handle(async () => {
    const start = starters[kind as keyof typeof starters];
    if (!start) throw new Error(`Unknown job ${kind}`);
    return start();
  });
}
