import type { MasterRow } from '../../lib/types.js';

export interface Kpis {
  activeSpend: { value: number; delta: number };
  itemsYtd: { value: number; delta: number };
  needsReview: { value: number };
}

export function computeKpis(rows: MasterRow[], needsReviewCount: number, now: Date): Kpis {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const activeRows = rows.filter((r) => r.status === 'active');
  const activeSpend = sum(activeRows.map((r) => r.price || 0));

  // Active-spend delta: this month's active purchases vs same month last year.
  const thisMonthSpend = sum(
    activeRows
      .filter((r) => sameYearMonth(r.date, year, month))
      .map((r) => r.price || 0),
  );
  const lastYearSameMonthSpend = sum(
    activeRows
      .filter((r) => sameYearMonth(r.date, year - 1, month))
      .map((r) => r.price || 0),
  );
  const activeSpendDelta = thisMonthSpend - lastYearSameMonthSpend;

  // Items YTD: rows dated in current year, excluding `excluded` status.
  const ytdRows = rows.filter((r) => r.status !== 'excluded' && inYear(r.date, year));
  const itemsYtd = ytdRows.length;

  // YoY delta for items YTD: vs same period of prior year (Jan 1 → today's MM/DD).
  const priorYtdRows = rows.filter((r) =>
    r.status !== 'excluded' && inYearUpToDoy(r.date, year - 1, now),
  );
  const itemsYtdDelta = itemsYtd - priorYtdRows.length;

  return {
    activeSpend: { value: Math.round(activeSpend * 100) / 100, delta: Math.round(activeSpendDelta * 100) / 100 },
    itemsYtd: { value: itemsYtd, delta: itemsYtdDelta },
    needsReview: { value: needsReviewCount },
  };
}

function sum(xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function inYear(s: string, year: number): boolean {
  const d = parseDate(s);
  return d !== null && d.y === year;
}

function sameYearMonth(s: string, year: number, month: number): boolean {
  const d = parseDate(s);
  return d !== null && d.y === year && d.m === month;
}

function inYearUpToDoy(s: string, year: number, now: Date): boolean {
  const d = parseDate(s);
  if (d === null || d.y !== year) return false;
  const nowDoy = dayOfYear(now.getUTCMonth() + 1, now.getUTCDate());
  const rowDoy = dayOfYear(d.m, d.d);
  return rowDoy <= nowDoy;
}

function dayOfYear(month: number, day: number): number {
  const cumulative = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return (cumulative[month - 1] ?? 0) + day;
}
