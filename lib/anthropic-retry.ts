import Anthropic from '@anthropic-ai/sdk';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;

export async function callWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries - 1) throw err;
      const delayMs = Math.min(baseDelayMs * 2 ** attempt, MAX_DELAY_MS) + Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export function isRetryable(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    err instanceof Anthropic.APIConnectionError ||
    err instanceof Anthropic.APIConnectionTimeoutError ||
    (err instanceof Anthropic.APIError &&
      (err.status === 529 || err.status === 503 || err.status === 504))
  );
}
