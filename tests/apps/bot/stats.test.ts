import { describe, test, expect } from 'vitest';
import { Stats, formatStats, evaluateThresholds, estimateMonthlyCost } from '../../../apps/bot/stats.js';

describe('Stats counter', () => {
  test('records per-query metrics', () => {
    const s = new Stats();
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 1500, totalResponseMs: 2200 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 4500, totalResponseMs: 5800 });
    expect(s.totalQueries).toBe(2);
    expect(s.cacheHits).toBe(1);
    expect(s.coldWrites).toBe(1);
  });

  test('records refreshes and tracks last refresh', () => {
    const s = new Stats();
    s.recordRefresh({ rowCount: 412, durationMs: 240, hashChanged: false });
    s.recordRefresh({ rowCount: 414, durationMs: 260, hashChanged: true });
    expect(s.totalRefreshes).toBe(2);
    expect(s.refreshesWithChange).toBe(1);
    expect(s.lastRowCount).toBe(414);
  });
});

describe('Stats.coldFirstTokenP50Ms', () => {
  test('only samples cold-cache queries, ignoring warm-cache ones', () => {
    const s = new Stats();
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 100, totalResponseMs: 500 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 4000, totalResponseMs: 5000 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 200, totalResponseMs: 700 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 5000, totalResponseMs: 6500 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 6000, totalResponseMs: 7800 });
    // Cold samples: [4000, 5000, 6000] → sorted → median = 5000
    expect(s.coldFirstTokenP50Ms()).toBe(5000);
  });

  test('returns 0 when no cold queries recorded', () => {
    const s = new Stats();
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 100, totalResponseMs: 500 });
    expect(s.coldFirstTokenP50Ms()).toBe(0);
  });
});

describe('estimateMonthlyCost', () => {
  test('extrapolates 7-day cold/warm counts to 30 days', () => {
    // 28 cold writes + 142 warm reads in 7 days at 12K tokens. Opus 4.7 pricing:
    // (28/7)*30 = 120 cold writes -> 120 * 12000 * $18.75/MTok = $27.00
    // (142/7)*30 ≈ 608 warm reads -> 608 * 12000 * $1.50/MTok ≈ $10.94
    // total ≈ $37.94
    const cost = estimateMonthlyCost({
      coldWrites7d: 28,
      warmReads7d: 142,
      avgSystemPromptTokens: 12000,
    });
    expect(cost).toBeGreaterThan(35);
    expect(cost).toBeLessThan(42);
  });

  test('returns 0 for no activity', () => {
    expect(estimateMonthlyCost({ coldWrites7d: 0, warmReads7d: 0, avgSystemPromptTokens: 0 })).toBe(0);
  });
});

describe('evaluateThresholds', () => {
  test('returns 0/4 hit at small inventory', () => {
    const r = evaluateThresholds({
      activeOutdoorRows: 400,
      monthlyCostUsd: 5,
      coldFirstTokenP50Ms: 4500,
      freeContextTokens: 188000,
    });
    expect(r.hitCount).toBe(0);
    expect(r.flips).toBe(false);
  });

  test('triggers flip when 2+ thresholds hit', () => {
    const r = evaluateThresholds({
      activeOutdoorRows: 2500, // hit
      monthlyCostUsd: 35,      // hit
      coldFirstTokenP50Ms: 4500,
      freeContextTokens: 188000,
    });
    expect(r.hitCount).toBe(2);
    expect(r.flips).toBe(true);
  });

  test('lists which thresholds hit', () => {
    const r = evaluateThresholds({
      activeOutdoorRows: 2500,
      monthlyCostUsd: 5,
      coldFirstTokenP50Ms: 9000, // hit
      freeContextTokens: 188000,
    });
    expect(r.hits).toEqual(['inventory_size', 'cold_latency']);
  });
});

describe('formatStats', () => {
  test('renders a human-readable summary', () => {
    const s = new Stats();
    s.recordRefresh({ rowCount: 412, durationMs: 240, hashChanged: false });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: true, firstTokenMs: 1500, totalResponseMs: 2200 });
    s.recordQuery({ systemPromptTokens: 12000, cacheHit: false, firstTokenMs: 4500, totalResponseMs: 5800 });

    const out = formatStats(s, { activeOutdoorRows: 287, freeContextTokens: 188000 });

    expect(out).toContain('Inventory: 412 rows (Outdoor active: 287)');
    expect(out).toContain('Last refresh:');
    expect(out).toContain('Last 7d:');
    expect(out).toContain('Threshold status: 0/4 hit');
  });
});
