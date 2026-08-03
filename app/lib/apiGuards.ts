// In-memory guards for the single-instance Railway web service.
// NOTE: state is per-process — if the web service is ever scaled to >1
// replica, move this to a shared store (Redis). Documented limitation.

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 60_000;

export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  // Rightmost entry = the IP Railway's edge proxy appended for this hop, which
  // the client cannot forge past. The leftmost entry is client-supplied and
  // trivially spoofable, so using it would let an attacker bypass the rate
  // limiter or pin another IP into a 429 lockout.
  const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  return last || 'unknown';
}

export function checkRateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): { ok: true } | { ok: false; retryAfterMs: number } {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    const oldest = b.hits[0];
    const retryAfterMs = oldest !== undefined ? windowMs - (now - oldest) : windowMs;
    buckets.set(key, b);
    return { ok: false, retryAfterMs };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true };
}

let spendDay = '';
let spendTotal = 0;

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordSpend(estimatedUsd: number): void {
  const day = utcDay();
  if (day !== spendDay) { spendDay = day; spendTotal = 0; }
  spendTotal += estimatedUsd;
}

export function overDailyBudget(): boolean {
  const day = utcDay();
  if (day !== spendDay) { spendDay = day; spendTotal = 0; }
  const ceiling = Number(process.env['DAILY_LLM_BUDGET_USD'] ?? '5');
  return spendTotal >= ceiling;
}

export function __resetGuardsForTest(): void {
  buckets.clear();
  spendDay = '';
  spendTotal = 0;
}
