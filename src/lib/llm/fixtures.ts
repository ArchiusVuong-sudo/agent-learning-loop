import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { LlmRequest, LlmResult } from './types';

const sha = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/** Exact identity of a request: same role, model, prompts, schema and tools. */
export function requestKey(request: LlmRequest): string {
  return sha(
    JSON.stringify({
      role: request.role,
      model: request.model,
      system: request.system,
      prompt: request.prompt,
      schema: request.outputSchema ?? null,
      tools: request.tools?.allowedTools ?? [],
    }),
  );
}

/** Looser identity used when a person edited part of the request after it was recorded. */
export function anchorKey(request: Pick<LlmRequest, 'role' | 'anchor'>): string {
  return sha(`${request.role}::${request.anchor}`);
}

const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean(),
});

export const fixtureSchema = z.object({
  key: z.string(),
  anchorKey: z.string(),
  role: z.string(),
  anchor: z.string(),
  model: z.string(),
  recordedAt: z.string(),
  result: z.object({
    text: z.string(),
    structured: z.unknown().optional(),
    toolCalls: z.array(toolCallSchema),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
    }),
    costUsd: z.number(),
    durationMs: z.number(),
    model: z.string(),
  }),
});

export type Fixture = z.infer<typeof fixtureSchema>;

export function fixtureFromResult(request: LlmRequest, result: LlmResult): Fixture {
  return {
    key: requestKey(request),
    anchorKey: anchorKey(request),
    role: request.role,
    anchor: request.anchor.slice(0, 300),
    model: request.model,
    recordedAt: new Date().toISOString(),
    result: {
      text: result.text,
      ...(result.structured === undefined ? {} : { structured: result.structured }),
      toolCalls: result.toolCalls,
      usage: result.usage,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      model: result.model,
    },
  };
}

/**
 * Writes one recorded response. The same request can be recorded more than once (a case copied
 * verbatim from a trace runs again in the gate), so later recordings get a numeric suffix.
 */
export function writeFixture(dir: string, fixture: Fixture): string {
  const roleDir = path.join(dir, fixture.role);
  mkdirSync(roleDir, { recursive: true });
  let file = path.join(roleDir, `${fixture.key}.json`);
  for (let n = 2; existsSync(file); n++) file = path.join(roleDir, `${fixture.key}-${n}.json`);
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  return file;
}

export interface FixtureIndex {
  /** Recordings per exact key, oldest first. */
  byKey: Map<string, Fixture[]>;
  byAnchor: Map<string, Fixture[]>;
  size: number;
}

/** Loads every fixture file under `dir`, grouped by key and by anchor in recording order. */
export function loadFixtures(dir: string): FixtureIndex {
  const byKey = new Map<string, Fixture[]>();
  const byAnchor = new Map<string, Fixture[]>();
  if (!existsSync(dir)) return { byKey, byAnchor, size: 0 };
  const files: string[] = [];
  for (const role of readdirSync(dir, { withFileTypes: true })) {
    if (!role.isDirectory()) continue;
    for (const file of readdirSync(path.join(dir, role.name))) {
      if (file.endsWith('.json')) files.push(path.join(dir, role.name, file));
    }
  }
  const fixtures = files
    .map((file) => fixtureSchema.parse(JSON.parse(readFileSync(file, 'utf8'))))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  for (const fixture of fixtures) {
    byKey.set(fixture.key, [...(byKey.get(fixture.key) ?? []), fixture]);
    byAnchor.set(fixture.anchorKey, [...(byAnchor.get(fixture.anchorKey) ?? []), fixture]);
  }
  return { byKey, byAnchor, size: fixtures.length };
}
