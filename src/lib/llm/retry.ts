import { LlmError } from './types';

const RETRYABLE = /overloaded|rate[ _-]?limit|too many requests|\b429\b|\b5\d\d\b|server[ _-]error|internal server error|service unavailable|bad gateway|gateway timeout|ECONNRESET|ETIMEDOUT|socket hang up/i;

/** Overloaded, rate-limit and 5xx failures are worth another try; everything else is not. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof LlmError) return error.code === 'retryable';
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return RETRYABLE.test(message);
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exponential backoff with full jitter. Returns the value and how many attempts it took. */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions): Promise<{ value: T; attempts: number }> {
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt === options.attempts || !isRetryable(error)) throw error;
      const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
      options.onRetry?.(attempt, error, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** A small counting semaphore that caps concurrent CLI subprocesses. */
export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (limit < 1) throw new Error('Semaphore limit must be at least 1');
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      // The releasing caller hands its slot straight to us, so `active` stays put.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  get inFlight(): number {
    return this.active;
  }
}
