import { RequestContext } from '@mastra/core/request-context';
import { CTX_PROMPT_VERSION } from '../agents';
import { agents } from '../mastra';
import { checkTrace, type CheckResult } from './checks';
import { getTraceView, type TraceSource, type TraceView } from './traces';

export interface SupportRun {
  traceId: string;
  trace: TraceView;
  check: CheckResult;
}

/**
 * One customer message through the support agent, traced into Mastra and checked online.
 * Tracing metadata carries the source and prompt version so lists can filter on them.
 */
export async function runSupport(message: string, opts: { source: TraceSource; requestId: string; promptVersion?: string }): Promise<SupportRun> {
  const requestContext = new RequestContext();
  if (opts.promptVersion) requestContext.set(CTX_PROMPT_VERSION, opts.promptVersion);
  const { traceId } = (await agents().supportAgent.generate(message, {
    requestContext,
    tracingOptions: { metadata: { source: opts.source, requestId: opts.requestId } },
  })) as { traceId?: string };
  if (!traceId) throw new Error('The support run produced no trace id');
  const trace = await getTraceView(traceId);
  if (!trace) throw new Error(`Trace ${traceId} was not found in storage`);
  const check = await checkTrace(trace);
  return { traceId, trace, check };
}

/** Runs async work over items with a fixed concurrency, reporting progress as each finishes. */
export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, onDone?: (done: number) => void): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]!, index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
      onDone?.(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
