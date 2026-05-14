export interface QueryMetrics {
  systemPromptTokens: number;
  cacheHit: boolean;
  firstTokenMs: number;
  totalResponseMs: number;
}

export interface RefreshMetrics {
  rowCount: number;
  durationMs: number;
  hashChanged: boolean;
}

export class Stats {
  totalQueries = 0;
  cacheHits = 0;
  coldWrites = 0;
  totalRefreshes = 0;
  refreshesWithChange = 0;
  lastRowCount = 0;
  lastRefreshAt: Date | null = null;
  private coldFirstTokenMsSamples: number[] = [];
  private systemPromptTokensSamples: number[] = [];
  private queryTimestamps: Date[] = [];
  private coldWriteTimestamps: Date[] = [];
  private warmReadTimestamps: Date[] = [];

  recordQuery(m: QueryMetrics): void {
    this.totalQueries += 1;
    if (m.cacheHit) {
      this.cacheHits += 1;
      this.warmReadTimestamps.push(new Date());
    } else {
      this.coldWrites += 1;
      this.coldWriteTimestamps.push(new Date());
      this.coldFirstTokenMsSamples.push(m.firstTokenMs);
    }
    this.systemPromptTokensSamples.push(m.systemPromptTokens);
    this.queryTimestamps.push(new Date());
    this.prune();
  }

  recordRefresh(m: RefreshMetrics): void {
    this.totalRefreshes += 1;
    if (m.hashChanged) this.refreshesWithChange += 1;
    this.lastRowCount = m.rowCount;
    this.lastRefreshAt = new Date();
  }

  coldWrites7d(): number {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.coldWriteTimestamps.filter((d) => d.getTime() >= cutoff).length;
  }

  warmReads7d(): number {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return this.warmReadTimestamps.filter((d) => d.getTime() >= cutoff).length;
  }

  avgSystemPromptTokens(): number {
    const arr = this.systemPromptTokensSamples;
    if (arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  coldFirstTokenP50Ms(): number {
    if (this.coldFirstTokenMsSamples.length === 0) return 0;
    const sorted = [...this.coldFirstTokenMsSamples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }

  private prune(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.queryTimestamps = this.queryTimestamps.filter((d) => d.getTime() >= cutoff);
    this.coldWriteTimestamps = this.coldWriteTimestamps.filter((d) => d.getTime() >= cutoff);
    this.warmReadTimestamps = this.warmReadTimestamps.filter((d) => d.getTime() >= cutoff);
    const cap = 1000;
    if (this.coldFirstTokenMsSamples.length > cap) this.coldFirstTokenMsSamples = this.coldFirstTokenMsSamples.slice(-cap);
    if (this.systemPromptTokensSamples.length > cap) this.systemPromptTokensSamples = this.systemPromptTokensSamples.slice(-cap);
  }
}

const PRICE_CACHE_WRITE_5MIN_USD_PER_MTOK = 3.75;
const PRICE_CACHE_READ_USD_PER_MTOK = 0.30;

export function estimateMonthlyCost(input: {
  coldWrites7d: number;
  warmReads7d: number;
  avgSystemPromptTokens: number;
}): number {
  const monthlyCold = (input.coldWrites7d / 7) * 30;
  const monthlyWarm = (input.warmReads7d / 7) * 30;
  const tokensM = input.avgSystemPromptTokens / 1_000_000;
  const coldCost = monthlyCold * tokensM * PRICE_CACHE_WRITE_5MIN_USD_PER_MTOK;
  const warmCost = monthlyWarm * tokensM * PRICE_CACHE_READ_USD_PER_MTOK;
  return Math.round((coldCost + warmCost) * 100) / 100;
}

export interface ThresholdInput {
  activeOutdoorRows: number;
  monthlyCostUsd: number;
  coldFirstTokenP50Ms: number;
  freeContextTokens: number;
}

export interface ThresholdResult {
  hits: string[];
  hitCount: number;
  flips: boolean;
}

export function evaluateThresholds(input: ThresholdInput): ThresholdResult {
  const hits: string[] = [];
  if (input.activeOutdoorRows >= 2000) hits.push('inventory_size');
  if (input.monthlyCostUsd > 30) hits.push('monthly_cost');
  if (input.coldFirstTokenP50Ms > 8000) hits.push('cold_latency');
  if (input.freeContextTokens < 40000) hits.push('context_budget');
  return { hits, hitCount: hits.length, flips: hits.length >= 2 };
}

export function formatStats(
  s: Stats,
  ctx: { activeOutdoorRows: number; freeContextTokens: number },
): string {
  const cost = estimateMonthlyCost({
    coldWrites7d: s.coldWrites7d(),
    warmReads7d: s.warmReads7d(),
    avgSystemPromptTokens: s.avgSystemPromptTokens(),
  });
  const thresh = evaluateThresholds({
    activeOutdoorRows: ctx.activeOutdoorRows,
    monthlyCostUsd: cost,
    coldFirstTokenP50Ms: s.coldFirstTokenP50Ms(),
    freeContextTokens: ctx.freeContextTokens,
  });
  const lastRefresh = s.lastRefreshAt
    ? `${ageMinutes(s.lastRefreshAt)} min ago`
    : 'never';
  const tokenStr = (s.avgSystemPromptTokens() / 1000).toFixed(1) + 'K';

  return [
    `Inventory: ${s.lastRowCount} rows (Outdoor active: ${ctx.activeOutdoorRows})`,
    `System prompt: ${tokenStr} tokens (avg)`,
    `Last refresh: ${lastRefresh}`,
    `Last 7d: ${s.coldWrites7d()} cold writes, ${s.warmReads7d()} warm reads`,
    `Est monthly cost: $${cost.toFixed(2)}`,
    `Threshold status: ${thresh.hitCount}/4 hit${thresh.hits.length ? ` (${thresh.hits.join(', ')})` : ''}`,
  ].join('\n');
}

function ageMinutes(d: Date): number {
  return Math.round((Date.now() - d.getTime()) / 60000);
}
