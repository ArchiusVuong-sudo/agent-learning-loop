import { SUPPORT_AGENT_ID } from '../agents';
import { flushTraces, observabilityStore } from '../mastra';

export type TraceSource = 'seed' | 'try' | 'shadow' | 'experiment';

export interface SpanView {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  type: string;
  startedAt: string;
  durationMs: number | null;
  input: unknown;
  output: unknown;
  error: string | null;
  attributes: Record<string, unknown>;
}

export interface ToolCallView {
  name: string;
  shortName: string;
  input: unknown;
  output: unknown;
  isError: boolean;
  durationMs: number | null;
}

export interface TraceView {
  traceId: string;
  requestId: string | null;
  source: TraceSource | string;
  promptVersion: string | null;
  experimentId: string | null;
  startedAt: string;
  durationMs: number | null;
  input: string;
  reply: string;
  error: string | null;
  toolCalls: ToolCallView[];
  costUsd: number;
  model: string | null;
  replayed: boolean;
  spans: SpanView[];
}

type RawSpan = {
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  spanType: string;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  attributes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  entityId?: string | null;
};

const seqOf = (span: { metadata?: Record<string, unknown> | null }) => (typeof span.metadata?.seq === 'number' ? span.metadata.seq : 0);
const byStart = (a: RawSpan, b: RawSpan) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || seqOf(a) - seqOf(b);

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : '');
const ms = (start: Date | string, end: Date | string | null | undefined) => (end ? new Date(end).getTime() - new Date(start).getTime() : null);

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return JSON.stringify(error);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text: unknown }).text ?? '');
  return '';
}

/** Turns a stored Mastra trace (agent_run root) into the shape the app and the checks use. */
export function toTraceView(traceId: string, rawSpans: RawSpan[]): TraceView | null {
  const root = rawSpans.find((s) => s.spanType === 'agent_run' && !rawSpans.some((p) => p.spanId === s.parentSpanId));
  if (!root) return null;
  const meta = root.metadata ?? {};
  const spans: SpanView[] = [...rawSpans]
    .sort((a, b) => (a.spanType === 'agent_run' ? -1 : b.spanType === 'agent_run' ? 1 : 0) || (a.spanType === 'model_generation' ? -1 : b.spanType === 'model_generation' ? 1 : 0) || byStart(a, b))
    .map((s) => ({
      spanId: s.spanId,
      parentSpanId: s.parentSpanId ?? null,
      name: s.name,
      type: s.spanType,
      startedAt: iso(s.startedAt),
      durationMs: ms(s.startedAt, s.endedAt),
      input: s.input ?? null,
      output: s.output ?? null,
      error: errorText(s.error),
      attributes: s.attributes ?? {},
    }));
  const toolCalls = rawSpans
    .filter((s) => s.spanType === 'mcp_tool_call' || s.spanType === 'tool_call')
    .sort((a, b) => seqOf(a) - seqOf(b) || byStart(a, b))
    .map((s) => {
      const name = s.entityId ?? s.name;
      return {
        name,
        shortName: name.replace(/^mcp__[^_]+__/, ''),
        input: s.input ?? null,
        output: s.output ?? errorText(s.error),
        isError: !!s.error,
        durationMs: ms(s.startedAt, s.endedAt),
      };
    });
  const model = rawSpans.find((s) => s.spanType === 'model_generation');
  const cost = (model?.attributes?.costContext as { estimatedCost?: number } | undefined)?.estimatedCost;
  return {
    traceId,
    requestId: typeof meta.requestId === 'string' ? meta.requestId : null,
    source: typeof meta.source === 'string' ? meta.source : meta.experimentId ? 'experiment' : 'unknown',
    promptVersion: typeof meta.promptVersion === 'string' ? meta.promptVersion : null,
    experimentId: typeof meta.experimentId === 'string' ? meta.experimentId : null,
    startedAt: iso(root.startedAt),
    durationMs: ms(root.startedAt, root.endedAt),
    input: textOf(root.input) || (typeof root.input === 'string' ? root.input : JSON.stringify(root.input ?? '')),
    reply: textOf(root.output),
    error: errorText(root.error),
    toolCalls,
    costUsd: typeof cost === 'number' ? cost : 0,
    model: typeof model?.attributes?.responseModel === 'string' ? (model.attributes.responseModel as string) : typeof model?.attributes?.model === 'string' ? (model.attributes.model as string) : null,
    replayed: meta.providerMode === 'replay',
    spans,
  };
}

/**
 * Reads one trace. Span events reach storage through Mastra's async exporter, so a read right
 * after a run polls briefly until the root span has ended.
 */
export async function getTraceView(traceId: string, waitMs = 5_000): Promise<TraceView | null> {
  const store = await observabilityStore();
  const deadline = Date.now() + waitMs;
  for (;;) {
    await flushTraces();
    const trace = await store.getTrace({ traceId });
    const spans = (trace?.spans ?? []) as unknown as RawSpan[];
    const view = spans.length ? toTraceView(traceId, spans) : null;
    const ended = spans.length > 0 && spans.every((s) => s.endedAt);
    if ((view && ended) || Date.now() > deadline) return view;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Support-agent traces only: filtered by the agent's entityId so judge, analyst and other helper
 * runs never count, then by source tag.
 */
export async function listSupportTraces(filter: { sources?: string[] } = {}): Promise<TraceView[]> {
  await flushTraces();
  const store = await observabilityStore();
  const ids: string[] = [];
  for (let page = 0; page < 20; page++) {
    const res = await store.listTraces({
      filters: { entityId: SUPPORT_AGENT_ID },
      pagination: { page, perPage: 100 },
      orderBy: { field: 'startedAt', direction: 'DESC' },
    });
    for (const span of res.spans) {
      const source = (span.metadata as Record<string, unknown> | null)?.source;
      if (filter.sources && !filter.sources.includes(String(source))) continue;
      ids.push(span.traceId);
    }
    if (!res.pagination?.hasMore) break;
  }
  const views = await Promise.all(
    ids.map(async (traceId) => {
      const trace = await store.getTrace({ traceId });
      return trace?.spans?.length ? toTraceView(traceId, trace.spans as unknown as RawSpan[]) : null;
    }),
  );
  return views.filter((v): v is TraceView => v !== null);
}
