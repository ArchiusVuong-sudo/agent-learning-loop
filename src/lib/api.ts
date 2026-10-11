import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { LlmError } from './llm/types';
import { ensureSetup } from './loop/pipeline';

/**
 * The replay miss anywhere in the error's cause chain. Matched by name and code as well as by
 * class: under `next start` each route bundle has its own copy of LlmError, and the provider on
 * globalThis throws the copy of whichever route created it, so instanceof alone can miss.
 */
export function replayMiss(error: unknown): Error | null {
  for (let e: unknown = error, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    if (e instanceof LlmError && e.code === 'replay_miss') return e;
    if (e instanceof Error && e.name === 'LlmError' && (e as { code?: unknown }).code === 'replay_miss') return e;
  }
  return null;
}

/** Wraps a route handler: sets up the store, returns JSON, and maps errors to status codes. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    await ensureSetup();
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') }, { status: 400 });
    }
    const miss = replayMiss(error);
    if (miss) {
      return NextResponse.json({ error: miss.message, code: 'replay_miss' }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function body<T>(request: Request, parse: (value: unknown) => T): Promise<T> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    value = {};
  }
  return parse(value);
}
