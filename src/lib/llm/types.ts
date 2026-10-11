import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRole } from '../config';

/** Tools the model may call, served from an in-process MCP server. */
export interface ToolBelt {
  serverName: string;
  server: McpSdkServerConfigWithInstance;
  /** Full SDK names, for example `mcp__store__lookup_order`. */
  allowedTools: string[];
}

export interface LlmRequest {
  role: AgentRole;
  model: string;
  system: string;
  prompt: string;
  maxTurns: number;
  tools?: ToolBelt;
  /** JSON schema for structured output. The caller validates the value with zod afterwards. */
  outputSchema?: Record<string, unknown>;
  /**
   * A stable, human-readable handle for this request (for example the customer message).
   * Replay mode falls back to it when the exact request was edited after recording.
   */
  anchor: string;
}

export interface ToolCallStart {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolCallEnd {
  id: string;
  output: unknown;
  isError: boolean;
}

export interface ToolCallRecord extends ToolCallStart {
  output: unknown;
  isError: boolean;
}

export interface LlmEvents {
  onToolCall?: (call: ToolCallStart) => void;
  onToolResult?: (result: ToolCallEnd) => void;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmResult {
  text: string;
  structured?: unknown;
  toolCalls: ToolCallRecord[];
  usage: LlmUsage;
  /** The SDK's own cost estimate for the query, in USD. */
  costUsd: number;
  durationMs: number;
  model: string;
  /** True when the response came from a recorded fixture rather than a live model call. */
  replayed: boolean;
  attempts: number;
}

export type ProviderMode = 'live' | 'replay';

export interface LlmProvider {
  readonly mode: ProviderMode;
  run(request: LlmRequest, events?: LlmEvents): Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly code: 'retryable' | 'fatal' | 'replay_miss' | 'invalid_output',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}
