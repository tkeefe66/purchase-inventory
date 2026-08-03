import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clientKey, checkRateLimit, recordSpend, overDailyBudget, __resetGuardsForTest,
} from '../../../app/lib/apiGuards.js';

describe('apiGuards', () => {
  beforeEach(() => { __resetGuardsForTest(); vi.unstubAllEnvs(); });

  it('extracts the first x-forwarded-for IP', () => {
    const r = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } });
    expect(clientKey(r)).toBe('1.2.3.4');
  });

  it('allows up to the limit then blocks with a retryAfter', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', { limit: 3, windowMs: 1000 }).ok).toBe(true);
    const blocked = checkRateLimit('k', { limit: 3, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('trips the daily budget once cumulative spend exceeds the ceiling', () => {
    vi.stubEnv('DAILY_LLM_BUDGET_USD', '1');
    expect(overDailyBudget()).toBe(false);
    recordSpend(0.6);
    recordSpend(0.6);
    expect(overDailyBudget()).toBe(true);
  });
});
