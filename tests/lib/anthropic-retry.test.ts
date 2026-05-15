import { describe, test, expect, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { callWithRetry, isRetryable } from '../../lib/anthropic-retry.js';

function overloadedError(): Error {
  return new Anthropic.APIError(
    529,
    { error: { type: 'overloaded_error', message: 'Overloaded' } } as never,
    'Overloaded',
    undefined,
  );
}

function badRequestError(): Error {
  return new Anthropic.APIError(
    400,
    { error: { type: 'invalid_request_error', message: 'Bad input' } } as never,
    'Bad input',
    undefined,
  );
}

describe('isRetryable', () => {
  test('flags 529 Overloaded as retryable', () => {
    expect(isRetryable(overloadedError())).toBe(true);
  });

  test('rejects 400 Bad Request', () => {
    expect(isRetryable(badRequestError())).toBe(false);
  });

  test('rejects non-Anthropic errors', () => {
    expect(isRetryable(new Error('something else'))).toBe(false);
    expect(isRetryable('not an error')).toBe(false);
  });
});

describe('callWithRetry', () => {
  test('returns immediately on success', async () => {
    const fn = vi.fn(async () => 'ok');
    const out = await callWithRetry(fn, { baseDelayMs: 0 });
    expect(out).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on retryable error and eventually succeeds', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      if (calls < 3) throw overloadedError();
      return 'success';
    };
    const out = await callWithRetry(fn, { baseDelayMs: 0, maxRetries: 5 });
    expect(out).toBe('success');
    expect(calls).toBe(3);
  });

  test('does not retry on non-retryable error', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      throw badRequestError();
    };
    await expect(callWithRetry(fn, { baseDelayMs: 0 })).rejects.toThrow(/Bad input/);
    expect(calls).toBe(1);
  });

  test('gives up after maxRetries and rethrows', async () => {
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      throw overloadedError();
    };
    await expect(callWithRetry(fn, { baseDelayMs: 0, maxRetries: 3 })).rejects.toThrow(/Overloaded/);
    expect(calls).toBe(3);
  });
});
