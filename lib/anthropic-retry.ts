import Anthropic from '@anthropic-ai/sdk';
import { report, type AnthropicUsageLike } from './usage.js';

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

/** App name from the coach-web repo's apps.yaml. A slug that isn't registered
 *  there is rejected with a 400, which the reporter logs. */
const COACH_APP = 'purchase-inventory';

/**
 * Report one Anthropic call to coach-web. Every Anthropic call in this repo
 * goes through callWithRetry, so this is the single reporting point — new call
 * sites are covered for free.
 *
 * callWithRetry is generic, so the result is duck-typed: anything that isn't a
 * Messages response (a `model` string plus a `usage` block) is ignored. A
 * streaming call would also be ignored — usage only exists on the final
 * message — but this repo has no `messages.stream` call sites today.
 *
 * Never throws: a lost data point must not fail the call it is measuring.
 */
function reportUsage(result: unknown): void {
  try {
    if (result === null || typeof result !== 'object') return;
    const { model, usage } = result as { model?: unknown; usage?: unknown };
    if (typeof model !== 'string') return;
    if (usage === null || typeof usage !== 'object') return;
    report(COACH_APP, model, usage as AnthropicUsageLike);
  } catch {
    // reporting must never surface in the calling app
  }
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
      const result = await fn();
      reportUsage(result);
      return result;
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
