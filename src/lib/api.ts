import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { LlmError } from './llm/types';
import { ensureSetup } from './loop/pipeline';

/** Wraps a route handler: sets up the store, returns JSON, and maps errors to status codes. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    await ensureSetup();
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') }, { status: 400 });
    }
    if (error instanceof LlmError && error.code === 'replay_miss') {
      return NextResponse.json({ error: error.message, code: 'replay_miss' }, { status: 422 });
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
