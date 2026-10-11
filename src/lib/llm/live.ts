import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config';
import { fixtureFromResult, writeFixture } from './fixtures';
import { Semaphore, isRetryable, withRetry } from './retry';
import { LlmError, type LlmEvents, type LlmProvider, type LlmRequest, type LlmResult, type ToolCallRecord } from './types';

const ENV_ALLOWLIST = ['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR', 'ANTHROPIC_API_KEY'] as const;
const RETRYABLE_ASSISTANT_ERRORS = new Set(['rate_limit', 'overloaded', 'server_error']);

/**
 * The child process gets only these variables. Everything else, including CLAUDECODE and
 * CLAUDE_CODE_* from a parent session, stays out.
 */
export function childEnv(source: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = source[name];
    if (value) env[name] = value;
  }
  return env;
}

/**
 * Query options shared by every agent in the app. No built-in Claude Code tools, no settings,
 * hooks, skills or MCP servers from this machine, no saved session, and a permission mode that
 * denies anything not listed in `allowedTools`.
 */
export function isolatedOptions(request: LlmRequest, cwd: string): Options {
  return {
    model: request.model,
    systemPrompt: request.system,
    tools: [],
    allowedTools: request.tools?.allowedTools ?? [],
    mcpServers: request.tools ? { [request.tools.serverName]: request.tools.server } : {},
    strictMcpConfig: true,
    settingSources: [],
    skills: [],
    plugins: [],
    agents: {},
    permissionMode: 'dontAsk',
    persistSession: false,
    maxTurns: request.maxTurns,
    cwd,
    env: childEnv(),
    ...(request.outputSchema ? { outputFormat: { type: 'json_schema', schema: request.outputSchema } } : {}),
  };
}

function parseToolOutput(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  const text = content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function contentBlocks(message: SDKMessage): Array<Record<string, unknown>> {
  if (message.type !== 'assistant' && message.type !== 'user') return [];
  const content = (message.message as { content?: unknown }).content;
  return Array.isArray(content) ? (content.filter((block) => block && typeof block === 'object') as Array<Record<string, unknown>>) : [];
}

async function runOnce(request: LlmRequest, events: LlmEvents | undefined): Promise<Omit<LlmResult, 'attempts'>> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'agent-loop-sandbox-'));
  const started = Date.now();
  const calls = new Map<string, ToolCallRecord>();
  try {
    let assistantError: string | undefined;
    for await (const message of query({ prompt: request.prompt, options: isolatedOptions(request, sandbox) })) {
      if (message.type === 'assistant' && message.error) assistantError = message.error;
      for (const block of contentBlocks(message)) {
        if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          const call: ToolCallRecord = { id: block.id, name: block.name, input: block.input, output: undefined, isError: false };
          calls.set(call.id, call);
          events?.onToolCall?.({ id: call.id, name: call.name, input: call.input });
        }
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const call = calls.get(block.tool_use_id);
          if (!call) continue;
          call.output = parseToolOutput(block.content);
          call.isError = block.is_error === true;
          events?.onToolResult?.({ id: call.id, output: call.output, isError: call.isError });
        }
      }
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success') {
        const detail = [...message.errors, assistantError ?? ''].join(' ').trim() || message.subtype;
        const retryable = (assistantError !== undefined && RETRYABLE_ASSISTANT_ERRORS.has(assistantError)) || isRetryable(detail);
        throw new LlmError(`${request.role} run failed: ${detail}`, retryable ? 'retryable' : 'fatal');
      }
      return {
        text: message.result,
        structured: message.structured_output,
        toolCalls: [...calls.values()],
        usage: {
          inputTokens: message.usage.input_tokens ?? 0,
          outputTokens: message.usage.output_tokens ?? 0,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        },
        costUsd: message.total_cost_usd ?? 0,
        durationMs: Date.now() - started,
        model: request.model,
        replayed: false,
      };
    }
    if (assistantError && RETRYABLE_ASSISTANT_ERRORS.has(assistantError)) {
      throw new LlmError(`${request.role} run ended early: ${assistantError}`, 'retryable');
    }
    throw new LlmError(`${request.role} run ended without a result`, 'fatal');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

export class LiveProvider implements LlmProvider {
  readonly mode = 'live' as const;
  private readonly gate: Semaphore;

  constructor(
    private readonly options: { maxConcurrent: number; record: boolean; fixturesDir: string } = {
      maxConcurrent: config.maxConcurrentRuns,
      record: config.recordFixtures,
      fixturesDir: config.fixturesDir,
    },
  ) {
    this.gate = new Semaphore(options.maxConcurrent);
  }

  async run(request: LlmRequest, events?: LlmEvents): Promise<LlmResult> {
    const { value, attempts } = await this.gate.use(() =>
      withRetry(() => runOnce(request, events), {
        attempts: 4,
        baseDelayMs: 2_000,
        maxDelayMs: 30_000,
        onRetry: (attempt, error, delayMs) =>
          console.warn(`[llm] ${request.role} attempt ${attempt} failed (${(error as Error).message}); retrying in ${delayMs} ms`),
      }),
    );
    const result: LlmResult = { ...value, attempts };
    if (this.options.record) writeFixture(this.options.fixturesDir, fixtureFromResult(request, result));
    return result;
  }
}
