/**
 * A Mastra Agent whose loop runs in the Claude Agent SDK, behind the app's LlmProvider so the
 * same agent can run live or replay recorded runs.
 *
 * The span shape (agent_run > model_generation + mcp_tool_call) and the output plumbing follow
 * @mastra/claude's ClaudeSDKAgent. We own the class instead of extending it for three reasons:
 * the provider seam for replay, per-run system prompts picked from requestContext (prompt
 * versions), and retry with backoff around the whole SDK query.
 */
import { ReadableStream } from 'node:stream/web';
import { Agent } from '@mastra/core/agent';
import { MessageList } from '@mastra/core/agent/message-list';
import type { Mastra } from '@mastra/core/mastra';
import { EntityType, SpanType, getOrCreateSpan, type AnySpan } from '@mastra/core/observability';
import { RequestContext } from '@mastra/core/request-context';
import { ChunkFrom, MastraModelOutput } from '@mastra/core/stream';
import { z } from 'zod';
import type { AgentRole } from '../config';
import { config } from '../config';
import { getProvider } from '../llm';
import type { LlmResult, ToolBelt } from '../llm/types';

export const PROVIDER_ID = 'claude-agent-sdk';

export interface ResolvedSystem {
  system: string;
  /** Recorded on the trace, for example `v1`. */
  promptVersion?: string;
}

export interface SdkAgentConfig {
  id: string;
  name: string;
  description: string;
  role: AgentRole;
  resolveSystem: (ctx: RequestContext) => Promise<ResolvedSystem>;
  tools?: () => ToolBelt;
  /** Stable handle for replay fallback. Defaults to the prompt text. */
  anchor?: (prompt: string, resolved: ResolvedSystem) => string;
}

/** What the last run did, for callers that need cost, latency and tool calls. */
export interface RunInfo {
  traceId: string | undefined;
  result: LlmResult;
  promptVersion: string | undefined;
}

type GenerateOptions = {
  requestContext?: RequestContext;
  tracingOptions?: { traceId?: string; metadata?: Record<string, unknown>; tags?: string[] };
  tracingContext?: { currentSpan?: AnySpan };
  structuredOutput?: { schema: unknown };
  runId?: string;
  /** Replay fallback handle for this call (overrides the agent's default). */
  anchor?: string;
  onRunInfo?: (info: RunInfo) => void;
  [key: string]: unknown;
};

export function promptToText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) return prompt.map(promptToText).filter(Boolean).join('\n');
  if (!prompt || typeof prompt !== 'object') return '';
  const record = prompt as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  if (record.content) return promptToText(record.content);
  if (Array.isArray(record.parts)) return promptToText(record.parts);
  return '';
}

function isZod(schema: unknown): schema is z.ZodType {
  return !!schema && typeof schema === 'object' && 'safeParse' in schema && '_zod' in schema;
}

export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function noopModel(modelId: string) {
  const empty = async () => ({ stream: new ReadableStream({ start: (controller) => controller.close() }) });
  return { modelId, provider: PROVIDER_ID, specificationVersion: 'v3' as const, supportedUrls: {}, doGenerate: empty, doStream: empty };
}

function completedStream(runId: string, prompt: string, result: LlmResult, object: unknown) {
  const textId = globalThis.crypto.randomUUID();
  const responseId = globalThis.crypto.randomUUID();
  const usage = {
    inputTokens: result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheWriteTokens + result.usage.outputTokens,
    cachedInputTokens: result.usage.cacheReadTokens,
  };
  const response = { id: responseId, modelId: result.model, timestamp: new Date() };
  const metadata = { request: { body: prompt }, modelId: result.model, timestamp: response.timestamp };
  const chunks: unknown[] = [
    { type: 'start', runId, from: ChunkFrom.AGENT, payload: {} },
    { type: 'step-start', runId, from: ChunkFrom.AGENT, payload: { request: { body: prompt } } },
    { type: 'response-metadata', runId, from: ChunkFrom.AGENT, payload: { id: responseId, modelId: result.model, timestamp: response.timestamp.toISOString() } },
    { type: 'text-start', runId, from: ChunkFrom.AGENT, payload: { id: textId } },
    ...(result.text ? [{ type: 'text-delta', runId, from: ChunkFrom.AGENT, payload: { id: textId, text: result.text } }] : []),
    { type: 'text-end', runId, from: ChunkFrom.AGENT, payload: { id: textId } },
    ...(object === undefined ? [] : [{ type: 'object-result', runId, from: ChunkFrom.AGENT, object }]),
    {
      type: 'step-finish',
      runId,
      from: ChunkFrom.AGENT,
      payload: { id: responseId, totalUsage: usage, response, stepResult: { reason: 'stop', warnings: [] }, output: { text: result.text, usage, steps: [] }, metadata },
    },
    {
      type: 'finish',
      runId,
      from: ChunkFrom.AGENT,
      payload: { stepResult: { reason: 'stop', warnings: [] }, output: { usage, steps: [] }, metadata, messages: { all: [], user: [], nonUser: [] }, response },
    },
  ];
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

export class SdkAgent extends Agent {
  #mastra: Mastra | undefined;

  constructor(readonly settings: SdkAgentConfig) {
    super({ id: settings.id, name: settings.name, description: settings.description, instructions: '', model: noopModel(config.models[settings.role]) as never });
  }

  __registerMastra(mastra: Mastra): void {
    super.__registerMastra(mastra);
    this.#mastra = mastra;
  }

  supportsMemory(): boolean {
    return false;
  }

  /** Runs one query and records it as a Mastra trace. Returns the text, the object and the trace id. */
  async execute(messages: unknown, options: GenerateOptions = {}) {
    const prompt = promptToText(messages);
    const runId = options.runId ?? globalThis.crypto.randomUUID();
    const requestContext = options.requestContext ?? new RequestContext();
    const resolved = await this.settings.resolveSystem(requestContext);
    const model = config.models[this.settings.role];
    const provider = getProvider();
    const schema = isZod(options.structuredOutput?.schema) ? options.structuredOutput.schema : undefined;

    const tracingOptions = {
      ...options.tracingOptions,
      metadata: {
        ...options.tracingOptions?.metadata,
        role: this.settings.role,
        providerMode: provider.mode,
        ...(resolved.promptVersion ? { promptVersion: resolved.promptVersion } : {}),
      },
    };
    const agentSpan = getOrCreateSpan({
      type: SpanType.AGENT_RUN,
      name: `agent run: '${this.id}'`,
      entityType: EntityType.AGENT,
      entityId: this.id,
      entityName: this.name,
      input: prompt,
      attributes: { instructions: resolved.system },
      metadata: { runId, sdkAgent: true, sdkProvider: PROVIDER_ID },
      tracingOptions,
      tracingContext: options.tracingContext,
      requestContext,
      mastra: this.#mastra,
    });
    const modelSpan = agentSpan?.createChildSpan({
      type: SpanType.MODEL_GENERATION,
      name: `llm: '${model}'`,
      input: { messages: [{ role: 'system', content: resolved.system }, { role: 'user', content: prompt }] },
      attributes: { model, provider: PROVIDER_ID, streaming: false },
    });
    const toolSpans = new Map<string, AnySpan>();
    // Replayed tool calls can share a millisecond, so each span also carries its call order.
    let toolSeq = 0;

    let result: LlmResult;
    try {
      result = await provider.run(
        {
          role: this.settings.role,
          model,
          system: resolved.system,
          prompt,
          maxTurns: config.maxTurns[this.settings.role],
          tools: this.settings.tools?.(),
          outputSchema: schema ? jsonSchemaFor(schema) : undefined,
          anchor: options.anchor ?? (this.settings.anchor ? this.settings.anchor(prompt, resolved) : prompt),
        },
        {
          onToolCall: (call) => {
            const span = agentSpan?.createChildSpan({
              type: SpanType.MCP_TOOL_CALL,
              name: `mcp_tool: '${call.name}'`,
              input: call.input,
              entityType: EntityType.TOOL,
              entityId: call.name,
              entityName: call.name,
              attributes: { mcpServer: call.name.split('__')[1] ?? 'store' },
              metadata: { toolCallId: call.id, seq: toolSeq++ },
            });
            if (span) toolSpans.set(call.id, span as AnySpan);
          },
          onToolResult: (end) => {
            const span = toolSpans.get(end.id);
            toolSpans.delete(end.id);
            if (!span) return;
            if (end.isError) {
              span.error({ error: new Error(typeof end.output === 'string' ? end.output : JSON.stringify(end.output)), attributes: { success: false } } as never);
            } else {
              span.end({ output: end.output, attributes: { success: true } } as never);
            }
          },
        },
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const span of toolSpans.values()) span.error({ error: failure } as never);
      modelSpan?.error({ error: failure });
      agentSpan?.error({ error: failure });
      throw error;
    }
    for (const span of toolSpans.values()) span.end({ attributes: { success: true } } as never);

    let object: unknown;
    if (schema) {
      let value = result.structured;
      if (value === undefined) {
        try {
          value = JSON.parse(result.text);
        } catch {
          value = undefined;
        }
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        const failure = new Error(`${this.id} returned output that does not match its schema: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        modelSpan?.error({ error: failure });
        agentSpan?.error({ error: failure });
        throw failure;
      }
      object = parsed.data;
    }

    modelSpan?.end({
      output: { text: result.text },
      attributes: {
        finishReason: 'stop',
        responseModel: result.model,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          inputDetails: { cacheRead: result.usage.cacheReadTokens, cacheWrite: result.usage.cacheWriteTokens },
        },
        costContext: { provider: 'anthropic', model: result.model, estimatedCost: result.costUsd, costUnit: 'USD', costMetadata: { source: 'sdk_estimate', replayed: result.replayed } },
      },
    } as never);
    agentSpan?.end({
      output: { text: result.text, ...(object === undefined ? {} : { object }) },
      metadata: { durationMs: result.durationMs, costUsd: result.costUsd, replayed: result.replayed, attempts: result.attempts },
    } as never);

    const traceId = agentSpan?.traceId;
    if (traceId) await this.waitForStoredTrace(traceId);
    options.onRunInfo?.({ traceId, result, promptVersion: resolved.promptVersion });
    return { prompt, runId, result, object, traceId, agentSpan, messages };
  }

  /**
   * Span events reach storage through an async exporter. Scorers (Mastra's trajectory scorer
   * among them) read the trace right after generate() returns, so wait until every span of this
   * run is stored and ended. Replayed runs finish in microseconds, which made this race visible.
   */
  private async waitForStoredTrace(traceId: string, timeoutMs = 5_000): Promise<void> {
    const store = await this.#mastra?.getStorage()?.getStore('observability');
    if (!store) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const trace = await store.getTrace({ traceId });
      const spans = trace?.spans ?? [];
      if (spans.length && spans.every((span) => span.endedAt)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private toOutput(run: Awaited<ReturnType<SdkAgent['execute']>>, options: GenerateOptions) {
    const messageList = new MessageList();
    messageList.add(run.messages as never, 'input');
    messageList.add([{ role: 'assistant', content: run.result.text }], 'response');
    return new MastraModelOutput({
      model: { modelId: run.result.model, provider: PROVIDER_ID, version: 'v3' },
      stream: completedStream(run.runId, run.prompt, run.result, run.object) as never,
      messageList,
      messageId: globalThis.crypto.randomUUID(),
      options: {
        runId: run.runId,
        requestContext: options.requestContext,
        tracingContext: run.agentSpan ? { currentSpan: run.agentSpan } : undefined,
        structuredOutput: options.structuredOutput,
      } as never,
    });
  }

  override async generate(messages: unknown, options?: GenerateOptions): Promise<never> {
    const run = await this.execute(messages, options);
    const full = (await this.toOutput(run, options ?? {}).getFullOutput()) as Record<string, unknown>;
    return { ...full, traceId: full.traceId ?? run.traceId, object: run.object } as never;
  }

  override async stream(messages: unknown, options?: GenerateOptions): Promise<never> {
    const run = await this.execute(messages, options);
    return this.toOutput(run, options ?? {}) as never;
  }
}
