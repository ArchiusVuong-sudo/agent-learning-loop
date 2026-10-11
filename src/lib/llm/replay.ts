import { anchorKey, loadFixtures, requestKey, type Fixture, type FixtureIndex } from './fixtures';
import { LlmError, type LlmEvents, type LlmProvider, type LlmRequest, type LlmResult } from './types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Serves model responses recorded from real live runs. Tool calls and their results are
 * replayed as recorded, so a replayed trace has the same spans as the original run.
 */
export class ReplayProvider implements LlmProvider {
  readonly mode = 'replay' as const;
  private index: FixtureIndex;
  /** How many times each key was served, so repeated requests replay in recording order. */
  private readonly served = new Map<string, number>();

  constructor(
    private readonly fixturesDir: string,
    /** Fraction of the recorded duration to wait, so progress bars still move. 0 in tests. */
    private readonly delayScale = Number(process.env.REPLAY_DELAY_SCALE ?? '0.04'),
  ) {
    this.index = loadFixtures(fixturesDir);
  }

  get size(): number {
    return this.index.size;
  }

  reload(): void {
    this.index = loadFixtures(this.fixturesDir);
    this.served.clear();
  }

  private next(map: Map<string, Fixture[]>, key: string, prefix: string): Fixture | undefined {
    const list = map.get(key);
    if (!list?.length) return undefined;
    const counterKey = `${prefix}:${key}`;
    const count = this.served.get(counterKey) ?? 0;
    this.served.set(counterKey, count + 1);
    return list[Math.min(count, list.length - 1)];
  }

  has(request: Pick<LlmRequest, 'role' | 'anchor'> & Partial<LlmRequest>): boolean {
    const exact = request.system !== undefined && this.index.byKey.has(requestKey(request as LlmRequest));
    return exact || this.index.byAnchor.has(anchorKey(request));
  }

  async run(request: LlmRequest, events?: LlmEvents): Promise<LlmResult> {
    const fixture = this.next(this.index.byKey, requestKey(request), 'key') ?? this.next(this.index.byAnchor, anchorKey(request), 'anchor');
    if (!fixture) {
      throw new LlmError(
        `Replay mode has no recorded ${request.role} response for this request. Run it live once with RECORD_FIXTURES=1 to record it.`,
        'replay_miss',
      );
    }
    const { result } = fixture;
    const stepDelay = Math.min(1_200, (result.durationMs * this.delayScale) / (result.toolCalls.length + 1));
    for (const call of result.toolCalls) {
      if (stepDelay > 0) await sleep(stepDelay);
      events?.onToolCall?.({ id: call.id, name: call.name, input: call.input });
      events?.onToolResult?.({ id: call.id, output: call.output, isError: call.isError });
    }
    if (stepDelay > 0) await sleep(stepDelay);
    return { ...result, toolCalls: result.toolCalls.map((call) => ({ ...call })), replayed: true, attempts: 1 };
  }
}
