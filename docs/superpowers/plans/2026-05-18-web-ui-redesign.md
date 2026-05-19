# Web UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Next.js web dashboard in "Gong-energy dark" (purple-tinted base, purple→pink gradient accents, rounded surfaces, KPI strip), introduce a sidebar that scales to N domains, and replace the four hardcoded filter dropdowns on the items table with per-column header-dropdown filters (including natural-language date and price range).

**Architecture:** Pure frontend redesign — no backend or data-layer changes. Filter state moves from component-local `useState` into URL search params via Next.js `useSearchParams`. New design tokens live in `tailwind.config.ts`. Items table refactored into a thin shell that composes new leaf components (`StatusPill`, `FilterChip`, `KpiCard`, `Sidebar`, `ColumnFilterPopover` + 5 type-specific filter contents). Spending + Needs review get palette-only restyles; structural redesign deferred.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript 5 strict, Tailwind 3.4, `chrono-node` (new dep for date NL parsing), Recharts 2 (existing), vitest 2 for pure-logic tests.

**Spec:** `docs/superpowers/specs/2026-05-18-web-ui-redesign-design.md` — re-read before starting if any task feels ambiguous.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `app/lib/filters.ts` | Pure functions to parse/serialize filter state ↔ URLSearchParams |
| `app/lib/kpi.ts` | Pure functions to compute Active spend / Items YTD / deltas |
| `app/lib/hooks/use-table-filters.ts` | Client hook: reads URL params, returns filtered rows + setters |
| `app/components/sidebar.tsx` | Desktop sidebar + mobile hamburger drawer (single component, CSS-responsive) |
| `app/components/kpi-card.tsx` | Label + value + optional delta |
| `app/components/filter-chip.tsx` | Active filter chip (with × remove) + add-filter dashed chip |
| `app/components/status-pill.tsx` | Color-coded pill for the 8 statuses |
| `app/components/column-filter-menu/popover.tsx` | Generic popover shell — positions under anchor, click-outside + Esc to close |
| `app/components/column-filter-menu/text-filter.tsx` | Filter content for text columns (Brand, Item, Category, Sub-cat, Notes) |
| `app/components/column-filter-menu/enum-filter.tsx` | Filter content for enum columns (Status, Domain, Type) |
| `app/components/column-filter-menu/date-filter.tsx` | Filter content for Date (chrono-node NL + presets) |
| `app/components/column-filter-menu/price-filter.tsx` | Filter content for Price (operator + range + presets) |
| `tests/app/lib/filters.test.ts` | Unit tests for filter state ↔ URL round-trip |
| `tests/app/lib/kpi.test.ts` | Unit tests for KPI math (deltas, YoY edge cases) |

### Modified files

| Path | What changes |
|---|---|
| `tailwind.config.ts` | Add full design token set (colors, shadows, gradients, radius scale, fonts) |
| `app/globals.css` | Add Inter import via next/font variable + light token CSS vars |
| `app/layout.tsx` | Replace top nav with `<Sidebar>` shell; mount Inter font variable on `<html>` |
| `app/page.tsx` | Add crumb + H1 + meta + KPI strip above `<ItemsTable>` |
| `app/components/items-table.tsx` | Major refactor — replace four-dropdown filter UI with chip toolbar + header-dropdown menus; integrate `useTableFilters`; sticky column headers; mobile card-list mode |
| `app/components/spending-charts.tsx` | Re-skin to new palette tokens; same chart types |
| `app/components/needs-review-table.tsx` | Re-skin to new palette tokens; same structure |
| `app/spending/page.tsx` | Add same crumb + H1 + meta + KPI strip header |
| `app/needs-review/page.tsx` | Add same crumb + H1 + meta + KPI strip header |
| `package.json` | Add `chrono-node` dep |

---

## Task 1: Add dependencies, Tailwind tokens, Inter font

**Files:**
- Modify: `package.json` (add `chrono-node`)
- Modify: `tailwind.config.ts`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Install chrono-node**

Run: `npm install chrono-node`
Expected: package added to dependencies, no peer warnings, `package-lock.json` updated.

- [ ] **Step 2: Replace `tailwind.config.ts` with full token set**

Overwrite `tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0f0d1a',
          sidebar: '#16142a',
          surface: '#16142a',
          'surface-raised': '#1a1730',
        },
        border: {
          subtle: '#211e3a',
          divider: '#1c1a30',
        },
        text: {
          primary: '#fafafa',
          body: '#e2e0eb',
          secondary: '#a09cb8',
          muted: '#6b6786',
        },
        accent: {
          from: '#a78bfa',
          to: '#f472b6',
        },
        status: {
          'active-fg': '#86efac',
          'active-bg': '#14301f',
          'broken-fg': '#fca5a5',
          'broken-bg': '#3f1414',
          'retired-fg': '#a1a1aa',
          'retired-bg': '#1f1f22',
          'returned-fg': '#fcd34d',
          'returned-bg': '#3f2e0e',
          'sold-fg': '#a5b4fc',
          'sold-bg': '#1e1b4b',
          'donated-fg': '#c4b5fd',
          'donated-bg': '#241942',
          'excluded-fg': '#71717a',
          'excluded-bg': '#18181b',
        },
        delta: {
          up: '#4ade80',
          down: '#f87171',
        },
        chip: {
          'active-from': '#2a1e4a',
          'active-to': '#3d1d3a',
          'active-border': '#a78bfa66',
          'active-text': '#e9d5ff',
          'add-border': '#3a3550',
        },
        badge: {
          warn: '#3f2e0e',
          'warn-text': '#fbbf24',
        },
      },
      backgroundImage: {
        'accent-gradient': 'linear-gradient(135deg, #a78bfa 0%, #f472b6 100%)',
        'chip-active': 'linear-gradient(135deg, #2a1e4a 0%, #3d1d3a 100%)',
        'blob-gradient': 'radial-gradient(circle, #a78bfa 0%, #f472b6 70%)',
      },
      boxShadow: {
        'accent-glow': '0 0 12px #a78bfa80',
        'card': '0 1px 3px rgba(17,12,46,0.06)',
        'popover': '0 12px 32px rgba(0,0,0,0.5)',
        'brand-mark': '0 4px 16px #8b5cf660',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        'shell': '14px',
        'card': '13px',
        'kpi': '11px',
        'chip': '9px',
        'pill': '7px',
        'input': '10px',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3: Replace `app/globals.css`**

Overwrite `app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  color-scheme: dark;
  --accent-from: #a78bfa;
  --accent-to: #f472b6;
}

html, body {
  background-color: #0f0d1a;
  color: #fafafa;
}

/* Hide scrollbars on mobile horizontal scroll-snap rows */
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
```

- [ ] **Step 4: Replace `app/layout.tsx` with Inter font wiring**

Overwrite `app/layout.tsx`:

```tsx
import './globals.css';
import { Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { Sidebar } from './components/sidebar';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Inventory',
  description: 'Personal purchase + inventory dashboard',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} bg-bg-base text-text-primary`}>
      <body className="min-h-screen font-sans">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

Note: this references `Sidebar` which we'll create in Task 8. TypeScript will error on this import until then — that's expected. We won't run typecheck until after Task 8.

- [ ] **Step 5: Commit**

Run:
```bash
git add package.json package-lock.json tailwind.config.ts app/globals.css app/layout.tsx
git commit -m "feat(web): design tokens, Inter font, sidebar layout shell (WIP — Sidebar import pending)"
```

---

## Task 2: Filter state module + tests (TDD)

**Files:**
- Create: `app/lib/filters.ts`
- Create: `tests/app/lib/filters.test.ts`

The module parses URL search params into a strongly-typed `FilterState` and serializes back. Round-trip must be lossless for every supported filter shape.

- [ ] **Step 1: Write the failing tests**

Create `tests/app/lib/filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  parseFilterState,
  serializeFilterState,
  type FilterState,
} from '../../../app/lib/filters.js';

describe('parseFilterState', () => {
  it('returns empty defaults for empty params', () => {
    const s = parseFilterState(new URLSearchParams(''));
    expect(s).toEqual({
      q: '', domain: '', status: [], brand: [], category: [], subCategory: [],
      type: [], year: [],
      date: undefined, price: undefined,
    });
  });

  it('parses search and single-value filters', () => {
    const s = parseFilterState(new URLSearchParams('q=patagonia&domain=outdoor'));
    expect(s.q).toBe('patagonia');
    expect(s.domain).toBe('outdoor');
  });

  it('parses multi-value comma-separated filters', () => {
    const s = parseFilterState(new URLSearchParams('status=active,retired&brand=Patagonia,Arc%27teryx'));
    expect(s.status).toEqual(['active', 'retired']);
    expect(s.brand).toEqual(['Patagonia', "Arc'teryx"]);
  });

  it('parses date preset', () => {
    const s = parseFilterState(new URLSearchParams('date=last-90-days'));
    expect(s.date).toEqual({ kind: 'preset', value: 'last-90-days' });
  });

  it('parses date year', () => {
    const s = parseFilterState(new URLSearchParams('date=2024'));
    expect(s.date).toEqual({ kind: 'year', value: 2024 });
  });

  it('parses date year-month', () => {
    const s = parseFilterState(new URLSearchParams('date=2024-05'));
    expect(s.date).toEqual({ kind: 'month', year: 2024, month: 5 });
  });

  it('parses date range', () => {
    const s = parseFilterState(new URLSearchParams('date=range:2024-03-01:2024-04-30'));
    expect(s.date).toEqual({ kind: 'range', start: '2024-03-01', end: '2024-04-30' });
  });

  it('parses price gte / lte / range', () => {
    expect(parseFilterState(new URLSearchParams('price=gte:100')).price).toEqual({ kind: 'gte', value: 100 });
    expect(parseFilterState(new URLSearchParams('price=lte:50')).price).toEqual({ kind: 'lte', value: 50 });
    expect(parseFilterState(new URLSearchParams('price=range:50:200')).price).toEqual({ kind: 'range', min: 50, max: 200 });
  });
});

describe('serializeFilterState', () => {
  it('omits empty values', () => {
    const empty: FilterState = {
      q: '', domain: '', status: [], brand: [], category: [], subCategory: [],
      type: [], year: [], date: undefined, price: undefined,
    };
    expect(serializeFilterState(empty).toString()).toBe('');
  });

  it('serializes simple values', () => {
    const s: FilterState = {
      q: 'patagonia', domain: 'outdoor',
      status: ['active'], brand: [], category: [], subCategory: [], type: [], year: [],
      date: undefined, price: undefined,
    };
    const out = serializeFilterState(s);
    expect(out.get('q')).toBe('patagonia');
    expect(out.get('domain')).toBe('outdoor');
    expect(out.get('status')).toBe('active');
  });

  it('round-trips date and price', () => {
    const s: FilterState = {
      q: '', domain: '',
      status: [], brand: [], category: [], subCategory: [], type: [], year: [],
      date: { kind: 'range', start: '2024-03-01', end: '2024-04-30' },
      price: { kind: 'range', min: 50, max: 200 },
    };
    const round = parseFilterState(serializeFilterState(s));
    expect(round.date).toEqual(s.date);
    expect(round.price).toEqual(s.price);
  });

  it('round-trips brand with apostrophe', () => {
    const s: FilterState = {
      q: '', domain: '',
      status: [], brand: ["Arc'teryx", 'Patagonia'], category: [], subCategory: [], type: [], year: [],
      date: undefined, price: undefined,
    };
    const round = parseFilterState(serializeFilterState(s));
    expect(round.brand).toEqual(["Arc'teryx", 'Patagonia']);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/app/lib/filters.test.ts`
Expected: fail with "Cannot find module '../../../app/lib/filters.js'".

- [ ] **Step 3: Implement `app/lib/filters.ts`**

Create `app/lib/filters.ts`:

```typescript
export type DateFilter =
  | { kind: 'preset'; value: 'last-30-days' | 'last-90-days' | 'ytd' | 'last-12-months' }
  | { kind: 'year'; value: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'range'; start: string; end: string };

export type PriceFilter =
  | { kind: 'gte'; value: number }
  | { kind: 'lte'; value: number }
  | { kind: 'range'; min: number; max: number };

export interface FilterState {
  q: string;
  domain: string;
  status: string[];
  brand: string[];
  category: string[];
  subCategory: string[];
  type: string[];
  year: string[];
  date: DateFilter | undefined;
  price: PriceFilter | undefined;
}

const MULTI_KEYS = ['status', 'brand', 'category', 'subCategory', 'type', 'year'] as const;

export function parseFilterState(params: URLSearchParams): FilterState {
  const multi: Record<string, string[]> = {};
  for (const k of MULTI_KEYS) {
    const raw = params.get(k);
    multi[k] = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  }

  return {
    q: params.get('q') ?? '',
    domain: params.get('domain') ?? '',
    status: multi.status!,
    brand: multi.brand!,
    category: multi.category!,
    subCategory: multi.subCategory!,
    type: multi.type!,
    year: multi.year!,
    date: parseDate(params.get('date')),
    price: parsePrice(params.get('price')),
  };
}

export function serializeFilterState(state: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.domain) p.set('domain', state.domain);
  for (const k of MULTI_KEYS) {
    const v = state[k];
    if (v.length > 0) p.set(k, v.join(','));
  }
  const ds = serializeDate(state.date);
  if (ds) p.set('date', ds);
  const ps = serializePrice(state.price);
  if (ps) p.set('price', ps);
  return p;
}

function parseDate(raw: string | null): DateFilter | undefined {
  if (!raw) return undefined;
  // range:YYYY-MM-DD:YYYY-MM-DD
  if (raw.startsWith('range:')) {
    const [, start, end] = raw.split(':');
    if (start && end) return { kind: 'range', start, end };
    return undefined;
  }
  // YYYY-MM (year + month)
  const ym = /^(\d{4})-(\d{2})$/.exec(raw);
  if (ym) return { kind: 'month', year: Number(ym[1]), month: Number(ym[2]) };
  // YYYY (year only)
  if (/^\d{4}$/.test(raw)) return { kind: 'year', value: Number(raw) };
  // preset
  type PresetValue = (DateFilter & { kind: 'preset' })['value'];
  const presets: readonly PresetValue[] = ['last-30-days', 'last-90-days', 'ytd', 'last-12-months'];
  if (presets.includes(raw as PresetValue)) {
    return { kind: 'preset', value: raw as PresetValue };
  }
  return undefined;
}

function serializeDate(d: DateFilter | undefined): string | null {
  if (!d) return null;
  switch (d.kind) {
    case 'preset': return d.value;
    case 'year': return String(d.value);
    case 'month': return `${d.year}-${String(d.month).padStart(2, '0')}`;
    case 'range': return `range:${d.start}:${d.end}`;
  }
}

function parsePrice(raw: string | null): PriceFilter | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('gte:')) {
    const v = Number(raw.slice(4));
    return Number.isFinite(v) ? { kind: 'gte', value: v } : undefined;
  }
  if (raw.startsWith('lte:')) {
    const v = Number(raw.slice(4));
    return Number.isFinite(v) ? { kind: 'lte', value: v } : undefined;
  }
  if (raw.startsWith('range:')) {
    const [, minStr, maxStr] = raw.split(':');
    const min = Number(minStr); const max = Number(maxStr);
    if (Number.isFinite(min) && Number.isFinite(max)) return { kind: 'range', min, max };
  }
  return undefined;
}

function serializePrice(p: PriceFilter | undefined): string | null {
  if (!p) return null;
  switch (p.kind) {
    case 'gte': return `gte:${p.value}`;
    case 'lte': return `lte:${p.value}`;
    case 'range': return `range:${p.min}:${p.max}`;
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/app/lib/filters.test.ts`
Expected: 11 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/lib/filters.ts tests/app/lib/filters.test.ts
git commit -m "feat(web): URL filter state parser + serializer with tests"
```

---

## Task 3: KPI computation module + tests (TDD)

**Files:**
- Create: `app/lib/kpi.ts`
- Create: `tests/app/lib/kpi.test.ts`

Pure functions to compute the three KPI strip values from a `MasterRow[]` snapshot.

- [ ] **Step 1: Write the failing tests**

Create `tests/app/lib/kpi.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeKpis } from '../../../app/lib/kpi.js';
import type { MasterRow } from '../../../lib/types.js';

function row(p: Partial<MasterRow>): MasterRow {
  return {
    year: '', date: '', category: '', subCategory: '', brand: '', itemName: '',
    color: '', size: '', qty: 1, price: 0, source: 'Other', orderId: '',
    status: 'active', domain: 'Outdoor', productUrl: '', type: 'Gear',
    reasoning: '', notes: '',
    ...p,
  };
}

describe('computeKpis', () => {
  it('sums active spend and excludes returned/excluded', () => {
    const rows = [
      row({ price: 100, status: 'active' }),
      row({ price: 50, status: 'active' }),
      row({ price: 200, status: 'returned' }),
      row({ price: 75, status: 'excluded' }),
    ];
    const k = computeKpis(rows, 3, new Date('2026-05-18'));
    expect(k.activeSpend.value).toBe(150);
  });

  it('counts items YTD from current year, excludes excluded', () => {
    const rows = [
      row({ date: '2026-01-15', status: 'active' }),
      row({ date: '2026-05-12', status: 'active' }),
      row({ date: '2026-03-01', status: 'excluded' }),
      row({ date: '2025-12-30', status: 'active' }),
    ];
    const k = computeKpis(rows, 0, new Date('2026-05-18'));
    expect(k.itemsYtd.value).toBe(2);
  });

  it('computes YoY delta vs same period prior year', () => {
    const rows = [
      row({ date: '2026-01-15' }), row({ date: '2026-05-01' }),
      row({ date: '2025-01-10' }), row({ date: '2025-02-20' }), row({ date: '2025-03-15' }),
      row({ date: '2025-12-30' }),
    ];
    const k = computeKpis(rows, 0, new Date('2026-05-18'));
    expect(k.itemsYtd.value).toBe(2);
    expect(k.itemsYtd.delta).toBe(-1); // 2 ytd this year vs 3 same period last year
  });

  it('computes active-spend delta vs same month last year', () => {
    const rows = [
      row({ date: '2026-05-12', price: 200, status: 'active' }),
      row({ date: '2025-05-08', price: 100, status: 'active' }),
      row({ date: '2025-05-22', price: 50, status: 'active' }),
    ];
    const k = computeKpis(rows, 0, new Date('2026-05-18'));
    expect(k.activeSpend.delta).toBe(50); // 200 this May vs 150 last May
  });

  it('passes through needsReview count untouched', () => {
    const k = computeKpis([], 7, new Date('2026-05-18'));
    expect(k.needsReview.value).toBe(7);
  });

  it('handles empty rows', () => {
    const k = computeKpis([], 0, new Date('2026-05-18'));
    expect(k.activeSpend.value).toBe(0);
    expect(k.itemsYtd.value).toBe(0);
    expect(k.needsReview.value).toBe(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/app/lib/kpi.test.ts`
Expected: fail with module-not-found.

- [ ] **Step 3: Implement `app/lib/kpi.ts`**

Create `app/lib/kpi.ts`:

```typescript
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
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/app/lib/kpi.test.ts`
Expected: 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/lib/kpi.ts tests/app/lib/kpi.test.ts
git commit -m "feat(web): KPI computation module (active spend, items YTD, deltas)"
```

---

## Task 4: `useTableFilters` hook

**Files:**
- Create: `app/lib/hooks/use-table-filters.ts`

Client-side hook tying URL search params (via Next.js `useSearchParams` + `useRouter`) to derived filtered rows. No new unit tests — pure-logic correctness comes from Task 2 + integration verification later.

- [ ] **Step 1: Create the hook**

Create `app/lib/hooks/use-table-filters.ts`:

```typescript
'use client';
import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseFilterState, serializeFilterState, type FilterState } from '../filters.js';
import type { MasterRow } from '../../../lib/types.js';

export interface UseTableFilters {
  state: FilterState;
  setState: (next: FilterState) => void;
  filtered: MasterRow[];
  total: number;
}

export function useTableFilters(rows: MasterRow[]): UseTableFilters {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const state = useMemo(() => parseFilterState(new URLSearchParams(search.toString())), [search]);

  const setState = useCallback((next: FilterState) => {
    const params = serializeFilterState(next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname]);

  const filtered = useMemo(() => applyFilters(rows, state), [rows, state]);

  return { state, setState, filtered, total: rows.length };
}

function applyFilters(rows: MasterRow[], s: FilterState): MasterRow[] {
  const q = s.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (s.domain && r.domain.toLowerCase() !== s.domain.toLowerCase()) return false;
    if (s.status.length && !s.status.includes(r.status)) return false;
    if (s.brand.length && !s.brand.includes(r.brand)) return false;
    if (s.category.length && !s.category.includes(r.category)) return false;
    if (s.subCategory.length && !s.subCategory.includes(r.subCategory)) return false;
    if (s.type.length && !s.type.includes(r.type)) return false;
    if (s.year.length && !s.year.includes(r.year)) return false;
    if (s.date && !matchDate(r.date, s.date)) return false;
    if (s.price && !matchPrice(r.price, s.price)) return false;
    if (q && !`${r.brand} ${r.itemName} ${r.category} ${r.subCategory} ${r.notes}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function matchDate(rowDate: string, f: NonNullable<FilterState['date']>): boolean {
  // rowDate is YYYY-MM-DD. All ranges are inclusive.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rowDate);
  if (!ymd) return false;
  const y = Number(ymd[1]); const m = Number(ymd[2]); const d = Number(ymd[3]);
  const today = new Date();
  const toIso = (dt: Date) => dt.toISOString().slice(0, 10);

  switch (f.kind) {
    case 'year':
      return y === f.value;
    case 'month':
      return y === f.year && m === f.month;
    case 'range':
      return rowDate >= f.start && rowDate <= f.end;
    case 'preset': {
      const start = presetStart(f.value, today);
      return rowDate >= toIso(start) && rowDate <= toIso(today);
    }
  }
}

function presetStart(p: 'last-30-days' | 'last-90-days' | 'ytd' | 'last-12-months', today: Date): Date {
  const d = new Date(today);
  switch (p) {
    case 'last-30-days': d.setUTCDate(d.getUTCDate() - 30); return d;
    case 'last-90-days': d.setUTCDate(d.getUTCDate() - 90); return d;
    case 'last-12-months': d.setUTCFullYear(d.getUTCFullYear() - 1); return d;
    case 'ytd': return new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  }
}

function matchPrice(price: number, f: NonNullable<FilterState['price']>): boolean {
  switch (f.kind) {
    case 'gte': return price >= f.value;
    case 'lte': return price <= f.value;
    case 'range': return price >= f.min && price <= f.max;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/lib/hooks/use-table-filters.ts
git commit -m "feat(web): useTableFilters hook (URL-backed filter state)"
```

---

## Task 5: `StatusPill` component

**Files:**
- Create: `app/components/status-pill.tsx`

- [ ] **Step 1: Create the component**

Create `app/components/status-pill.tsx`:

```tsx
import type { Status } from '../../lib/types.js';

const STYLES: Record<Status, string> = {
  active:   'text-status-active-fg bg-status-active-bg',
  broken:   'text-status-broken-fg bg-status-broken-bg',
  lost:     'text-status-broken-fg bg-status-broken-bg',
  retired:  'text-status-retired-fg bg-status-retired-bg',
  returned: 'text-status-returned-fg bg-status-returned-bg',
  sold:     'text-status-sold-fg bg-status-sold-bg',
  donated:  'text-status-donated-fg bg-status-donated-bg',
  excluded: 'text-status-excluded-fg bg-status-excluded-bg',
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10px] font-semibold ${STYLES[status]}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/status-pill.tsx
git commit -m "feat(web): StatusPill component"
```

---

## Task 6: `FilterChip` component

**Files:**
- Create: `app/components/filter-chip.tsx`

- [ ] **Step 1: Create the component**

Create `app/components/filter-chip.tsx`:

```tsx
'use client';

interface ActiveChipProps {
  label: string;
  onRemove: () => void;
}

export function ActiveFilterChip({ label, onRemove }: ActiveChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip border border-chip-active-border bg-chip-active px-2.5 py-1 text-[11px] font-medium text-chip-active-text shadow-[0_0_12px_#a78bfa20]">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="cursor-pointer text-text-muted hover:text-text-primary"
        aria-label={`Remove filter ${label}`}
      >
        ×
      </button>
    </span>
  );
}

interface AddChipProps {
  onClick?: () => void;
}

export function AddFilterChip({ onClick }: AddChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex cursor-pointer items-center gap-1 rounded-chip border border-dashed border-chip-add-border bg-transparent px-2.5 py-1 text-[11px] text-text-muted hover:text-text-secondary"
    >
      + Filter
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/filter-chip.tsx
git commit -m "feat(web): FilterChip (active + add) components"
```

---

## Task 7: `KpiCard` component

**Files:**
- Create: `app/components/kpi-card.tsx`

- [ ] **Step 1: Create the component**

Create `app/components/kpi-card.tsx`:

```tsx
interface Props {
  label: string;
  value: string;
  delta?: { value: string; direction: 'up' | 'down' } | undefined;
  href?: string;
}

export function KpiCard({ label, value, delta, href }: Props) {
  const content = (
    <div className="rounded-kpi border border-border-subtle bg-bg-surface p-3.5 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-bold tracking-[-0.015em] tabular-nums text-text-primary">{value}</div>
      {delta && (
        <div className={`mt-0.5 text-[10px] tabular-nums ${delta.direction === 'up' ? 'text-delta-up' : 'text-delta-down'}`}>
          {delta.direction === 'up' ? '↑' : '↓'} {delta.value}
        </div>
      )}
    </div>
  );
  if (href) {
    return (
      <a href={href} className="block transition hover:brightness-110">
        {content}
      </a>
    );
  }
  return content;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/kpi-card.tsx
git commit -m "feat(web): KpiCard component"
```

---

## Task 8: `Sidebar` component (desktop + mobile drawer)

**Files:**
- Create: `app/components/sidebar.tsx`

Renders the persistent sidebar on desktop (≥768px) and a hamburger trigger + slide-in drawer on mobile. Reads `?domain=` from the URL to mark the active domain. Hardcodes the three domain names today; future domains will need a manual edit.

- [ ] **Step 1: Create the component**

Create `app/components/sidebar.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const DOMAINS = [
  { slug: 'outdoor', label: 'Outdoor', active: true },
  { slug: 'kitchen', label: 'Kitchen', active: false },
  { slug: 'photography', label: 'Photography', active: false },
];

export function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger trigger — fixed top-left */}
      <button
        type="button"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-30 inline-flex items-center justify-center rounded-input border border-border-subtle bg-bg-sidebar p-2.5 text-text-secondary md:hidden"
      >
        <span className="block h-0.5 w-4 bg-current shadow-[0_5px_0_currentColor,0_-5px_0_currentColor]" />
      </button>

      {/* Backdrop (mobile only, when drawer open) */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Sidebar — fixed drawer on mobile, sticky column on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[200px] flex-shrink-0 border-r border-border-subtle bg-bg-sidebar px-3 py-4 transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'} md:w-[170px]`}
      >
        <BrandMark />
        <Section title="Domains" />
        {DOMAINS.map((d) => (
          <DomainLink key={d.slug} {...d} onClick={() => setOpen(false)} />
        ))}
        <Section title="Everything" />
        <NavLink href="/" label="All items" onClick={() => setOpen(false)} clearDomain />
        <NavLink href="/spending" label="Spending" onClick={() => setOpen(false)} />
        <NavLink href="/needs-review" label="Needs review" onClick={() => setOpen(false)} />
        <Section title="Agent" />
        <span className="block px-2 py-1.5 text-[13px] text-text-muted">
          Chat <span className="ml-1 text-[9px] uppercase tracking-wide">soon</span>
        </span>

        <div className="absolute inset-x-3 bottom-3 border-t border-border-divider pt-2.5 text-[10px] text-text-muted">
          tkeefe66 · v1.4
        </div>
      </aside>
    </>
  );
}

function BrandMark() {
  return (
    <div className="mb-4 flex items-center gap-2 px-2">
      <div className="h-[22px] w-[22px] rounded-[7px] bg-accent-gradient shadow-brand-mark" />
      <span className="text-[17px] font-bold tracking-[-0.025em] text-text-primary">Inventory</span>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="mt-3 mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {title}
    </div>
  );
}

function DomainLink({
  slug, label, active, onClick,
}: { slug: string; label: string; active: boolean; onClick: () => void }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const currentDomain = search.get('domain') ?? '';
  const isActive = pathname === '/' && currentDomain === slug;
  return (
    <Link
      href={`/?domain=${slug}`}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-chip px-2 py-1.5 text-[13px] ${
        isActive
          ? 'bg-chip-active font-semibold text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      <span
        className={`h-[7px] w-[7px] rounded-full ${
          isActive ? 'bg-accent-gradient shadow-accent-glow' : 'bg-border-subtle'
        }`}
      />
      {label}
      {!active && <span className="ml-auto text-[10px] text-text-muted">—</span>}
    </Link>
  );
}

function NavLink({
  href, label, onClick, clearDomain = false,
}: { href: string; label: string; onClick: () => void; clearDomain?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const currentDomain = search.get('domain') ?? '';
  const isActive = pathname === href && (!clearDomain || !currentDomain);
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`block rounded-chip px-2 py-1.5 text-[13px] ${
        isActive
          ? 'bg-chip-active font-semibold text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </Link>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes (this resolves the Sidebar import added in Task 1 Step 4).

- [ ] **Step 3: Commit**

```bash
git add app/components/sidebar.tsx
git commit -m "feat(web): Sidebar component (desktop + mobile drawer)"
```

---

## Task 9: Column filter popover shell

**Files:**
- Create: `app/components/column-filter-menu/popover.tsx`

Generic anchored popover. Renders children, handles outside-click and Escape to close. Used by all five filter-type components in subsequent tasks.

- [ ] **Step 1: Create the shell**

Create `app/components/column-filter-menu/popover.tsx`:

```tsx
'use client';
import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  anchor: HTMLElement | null;
  children: React.ReactNode;
}

export function ColumnFilterPopover({ open, onClose, anchor, children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchor && !anchor.contains(t)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;

  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 6;
  const left = rect.left + window.scrollX;

  return (
    <div
      ref={ref}
      style={{ position: 'absolute', top, left, width: 260 }}
      className="z-50 rounded-input border border-border-subtle bg-bg-surface p-3 shadow-popover"
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/column-filter-menu/popover.tsx
git commit -m "feat(web): ColumnFilterPopover shell"
```

---

## Task 10: Text + Enum filter content

**Files:**
- Create: `app/components/column-filter-menu/text-filter.tsx`
- Create: `app/components/column-filter-menu/enum-filter.tsx`

These two share a checkbox-list pattern; bundled into one task. (Year is filterable via the date NL parser — "2024", "2025" — so a separate Year filter UI isn't needed in v1.)

- [ ] **Step 1: Create `text-filter.tsx`**

Create `app/components/column-filter-menu/text-filter.tsx`:

```tsx
'use client';
import { useState, useMemo } from 'react';

interface Props {
  label: string;
  selected: string[];
  options: string[];
  onChange: (next: string[]) => void;
}

export function TextFilter({ label, selected, options, onChange }: Props) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const lq = q.trim().toLowerCase();
    return lq ? options.filter((o) => o.toLowerCase().includes(lq)) : options;
  }, [options, q]);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  }

  return (
    <>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label} filter</div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Filter ${label.toLowerCase()}…`}
        className="mb-2 w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
      />
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 && <div className="px-2 py-3 text-center text-[11px] text-text-muted">No matches</div>}
        {filtered.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-text-body hover:bg-bg-surface-raised">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-accent-from" />
            <span className="truncate">{opt}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([])}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}
```

- [ ] **Step 2: Create `enum-filter.tsx`**

Create `app/components/column-filter-menu/enum-filter.tsx`:

```tsx
'use client';

interface Props {
  label: string;
  selected: string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
}

export function EnumFilter({ label, selected, options, onChange }: Props) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((s) => s !== value) : [...selected, value]);
  }
  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label} filter</div>
      <div className="max-h-56 overflow-y-auto">
        {options.map((opt) => (
          <label key={opt} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-text-body hover:bg-bg-surface-raised">
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="accent-accent-from" />
            <span>{opt}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([])}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/column-filter-menu/text-filter.tsx app/components/column-filter-menu/enum-filter.tsx
git commit -m "feat(web): Text + Enum filter menu contents"
```

---

## Task 11: Date filter content (chrono-node)

**Files:**
- Create: `app/components/column-filter-menu/date-filter.tsx`

Natural-language input parses with chrono-node; resolves to a `DateFilter` and updates state. Preset chips for quick selection.

- [ ] **Step 1: Create `date-filter.tsx`**

Create `app/components/column-filter-menu/date-filter.tsx`:

```tsx
'use client';
import { useState, useMemo } from 'react';
import * as chrono from 'chrono-node';
import type { DateFilter } from '../../lib/filters.js';

interface Props {
  value: DateFilter | undefined;
  onChange: (next: DateFilter | undefined) => void;
  yearsInData: string[];
}

type PresetValue = 'last-30-days' | 'last-90-days' | 'ytd' | 'last-12-months';
const PRESETS: { value: PresetValue; label: string }[] = [
  { value: 'last-30-days', label: 'Last 30d' },
  { value: 'last-90-days', label: 'Last 90d' },
  { value: 'ytd', label: 'YTD' },
  { value: 'last-12-months', label: 'Last 12mo' },
];

export function DateFilterMenu({ value, onChange, yearsInData }: Props) {
  const [input, setInput] = useState('');

  // Try to interpret the user's text on every keystroke.
  const parsed = useMemo(() => interpret(input), [input]);

  return (
    <>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Date filter</div>
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed) {
            onChange(parsed);
            setInput('');
          }
        }}
        placeholder="last 90 days, 2024, may 2025, between mar 1 and apr 30…"
        className="mb-1.5 w-full rounded-input border border-border-subtle bg-bg-base px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
      />
      <div className="mb-2 text-[10px] text-text-muted">Press Enter to apply</div>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Or pick</div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = value?.kind === 'preset' && value.value === p.value;
          return (
            <button key={p.value} type="button" onClick={() => onChange({ kind: 'preset', value: p.value })}
              className={chip(active)}>
              {p.label}
            </button>
          );
        })}
        {yearsInData.slice(0, 4).map((y) => {
          const active = value?.kind === 'year' && value.value === Number(y);
          return (
            <button key={y} type="button" onClick={() => onChange({ kind: 'year', value: Number(y) })}
              className={chip(active)}>
              {y}
            </button>
          );
        })}
      </div>

      {value && (
        <div className="mb-2 text-[11px] text-text-secondary">
          Active: <span className="text-text-primary">{describe(value)}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange(undefined)}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}

function chip(active: boolean): string {
  return active
    ? 'rounded-chip border border-chip-active-border bg-chip-active px-2.5 py-1 text-[11px] text-chip-active-text'
    : 'rounded-chip border border-border-subtle bg-bg-base px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary';
}

function describe(d: DateFilter): string {
  switch (d.kind) {
    case 'preset': return d.value.replace(/-/g, ' ');
    case 'year': return String(d.value);
    case 'month': return `${monthName(d.month)} ${d.year}`;
    case 'range': return `${d.start} → ${d.end}`;
  }
}

function monthName(m: number): string {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] ?? '';
}

function interpret(raw: string): DateFilter | undefined {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;

  // YYYY (e.g. "2024")
  if (/^\d{4}$/.test(text)) return { kind: 'year', value: Number(text) };

  // YYYY-MM or "month YYYY" / "month YY"
  const ymd = chrono.parse(text);
  if (ymd.length === 0) return undefined;
  const res = ymd[0]!;

  // Range — e.g. "between mar 1 and apr 30" yields two start/end components
  if (res.end) {
    return { kind: 'range', start: toIso(res.start.date()), end: toIso(res.end.date()) };
  }

  const d = res.start.date();
  const hasDay = res.start.isCertain('day');
  const hasMonth = res.start.isCertain('month');

  if (hasMonth && !hasDay) {
    return { kind: 'month', year: d.getFullYear(), month: d.getMonth() + 1 };
  }
  // Single-day result — treat as a 1-day range
  return { kind: 'range', start: toIso(d), end: toIso(d) };
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/components/column-filter-menu/date-filter.tsx
git commit -m "feat(web): Date filter menu with chrono-node NL parsing"
```

---

## Task 12: Price filter content

**Files:**
- Create: `app/components/column-filter-menu/price-filter.tsx`

- [ ] **Step 1: Create `price-filter.tsx`**

Create `app/components/column-filter-menu/price-filter.tsx`:

```tsx
'use client';
import { useState, useEffect } from 'react';
import type { PriceFilter } from '../../lib/filters.js';

interface Props {
  value: PriceFilter | undefined;
  onChange: (next: PriceFilter | undefined) => void;
}

const PRESETS: { label: string; filter: PriceFilter }[] = [
  { label: 'Under $50',   filter: { kind: 'lte', value: 50 } },
  { label: '$50–$200',    filter: { kind: 'range', min: 50, max: 200 } },
  { label: '$200–$500',   filter: { kind: 'range', min: 200, max: 500 } },
  { label: 'Over $500',   filter: { kind: 'gte', value: 500 } },
];

export function PriceFilter({ value, onChange }: Props) {
  const [op, setOp] = useState<'gte' | 'lte' | 'range'>(value?.kind ?? 'gte');
  const [a, setA] = useState<string>(initialA(value));
  const [b, setB] = useState<string>(initialB(value));

  useEffect(() => {
    if (value) {
      setOp(value.kind);
      setA(initialA(value));
      setB(initialB(value));
    }
  }, [value]);

  function apply() {
    const an = Number(a); const bn = Number(b);
    if (op === 'gte' && Number.isFinite(an)) onChange({ kind: 'gte', value: an });
    else if (op === 'lte' && Number.isFinite(an)) onChange({ kind: 'lte', value: an });
    else if (op === 'range' && Number.isFinite(an) && Number.isFinite(bn)) onChange({ kind: 'range', min: an, max: bn });
  }

  return (
    <>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Price filter</div>
      <div className="mb-2 flex gap-1.5">
        <select
          value={op}
          onChange={(e) => setOp(e.target.value as 'gte' | 'lte' | 'range')}
          className="rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary"
        >
          <option value="gte">≥</option>
          <option value="lte">≤</option>
          <option value="range">between</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={a}
          onChange={(e) => setA(e.target.value)}
          placeholder="$"
          className="w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted"
        />
        {op === 'range' && (
          <input
            type="number"
            inputMode="decimal"
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="$"
            className="w-full rounded-input border border-border-subtle bg-bg-base px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted"
          />
        )}
      </div>
      <button type="button" onClick={apply} className="mb-3 w-full rounded-input bg-accent-gradient py-1.5 text-[12px] font-semibold text-bg-base">
        Apply
      </button>

      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">Or pick</div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = isSame(value, p.filter);
          return (
            <button key={p.label} type="button" onClick={() => onChange(p.filter)}
              className={active
                ? 'rounded-chip border border-chip-active-border bg-chip-active px-2.5 py-1 text-[11px] text-chip-active-text'
                : 'rounded-chip border border-border-subtle bg-bg-base px-2.5 py-1 text-[11px] text-text-secondary hover:text-text-primary'}>
              {p.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onChange(undefined)}
        className="mt-2 w-full border-t border-border-divider pt-2 text-left text-[11px] text-text-muted hover:text-text-secondary"
      >
        Clear filter
      </button>
    </>
  );
}

function initialA(v: PriceFilter | undefined): string {
  if (!v) return '';
  if (v.kind === 'range') return String(v.min);
  return String(v.value);
}

function initialB(v: PriceFilter | undefined): string {
  if (v?.kind === 'range') return String(v.max);
  return '';
}

function isSame(a: PriceFilter | undefined, b: PriceFilter): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'range' && b.kind === 'range') return a.min === b.min && a.max === b.max;
  if (a.kind !== 'range' && b.kind !== 'range') return a.value === b.value;
  return false;
}
```

- [ ] **Step 2: Commit**

```bash
git add app/components/column-filter-menu/price-filter.tsx
git commit -m "feat(web): Price filter menu (operator + range + presets)"
```

---

## Task 13: Items table refactor

**Files:**
- Modify: `app/components/items-table.tsx` (complete rewrite)

The refactored table uses `useTableFilters`, renders an active-chip toolbar, opens column-filter menus on hover-icon click, sticky column headers, comfortable rows with stacked sub-category, and a mobile card-list view.

- [ ] **Step 1: Rewrite `items-table.tsx`**

Overwrite `app/components/items-table.tsx`:

```tsx
'use client';
import { useMemo, useRef, useState } from 'react';
import type { MasterRow, Status } from '../../lib/types.js';
import { STATUS_VALUES } from '../../lib/types.js';
import { useTableFilters } from '../lib/hooks/use-table-filters.js';
import { ColumnFilterPopover } from './column-filter-menu/popover.js';
import { TextFilter } from './column-filter-menu/text-filter.js';
import { EnumFilter } from './column-filter-menu/enum-filter.js';
import { DateFilterMenu } from './column-filter-menu/date-filter.js';
import { PriceFilter as PriceFilterMenu } from './column-filter-menu/price-filter.js';
import { ActiveFilterChip } from './filter-chip.js';
import { StatusPill } from './status-pill.js';

type SortKey = 'date' | 'brand' | 'itemName' | 'price' | 'category' | 'status';
type SortDir = 'asc' | 'desc';
type FilterKey = 'date' | 'brand' | 'itemName' | 'category' | 'subCategory' | 'price' | 'status';

export function ItemsTable({ rows }: { rows: MasterRow[] }) {
  const { state, setState, filtered, total } = useTableFilters(rows);
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [openFilter, setOpenFilter] = useState<{ key: FilterKey; anchor: HTMLElement } | null>(null);

  const brands = useMemo(() => uniqueSorted(rows.map((r) => r.brand)), [rows]);
  const items = useMemo(() => uniqueSorted(rows.map((r) => r.itemName)), [rows]);
  const categories = useMemo(() => uniqueSorted(rows.map((r) => r.category)), [rows]);
  const subCats = useMemo(() => uniqueSorted(rows.map((r) => r.subCategory)), [rows]);
  const years = useMemo(() => uniqueSorted(rows.map((r) => r.year)).sort((a, b) => b.localeCompare(a)), [rows]); // passed to DateFilterMenu for year preset chips

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'price': return (a.price - b.price) * dir;
        case 'date': return a.date.localeCompare(b.date) * dir;
        case 'brand': return a.brand.localeCompare(b.brand) * dir;
        case 'itemName': return a.itemName.localeCompare(b.itemName) * dir;
        case 'category': return a.category.localeCompare(b.category) * dir;
        case 'status': return a.status.localeCompare(b.status) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'price' || key === 'date' ? 'desc' : 'asc'); }
  }
  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function clearAll() { setState({ ...state, q: '' }); }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search" placeholder="Search…"
          value={state.q}
          onChange={(e) => setState({ ...state, q: e.target.value })}
          className="w-44 rounded-input border border-border-subtle bg-bg-surface px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-from"
        />
        {activeFilterChips(state, setState)}
        {/* AddFilterChip (column picker) deferred — column-header dropdowns are the v1 primary filter affordance */}
        <span className="ml-auto text-[11px] tabular-nums text-text-muted">{filtered.length} of {total}</span>
        {(state.status.length || state.brand.length || state.category.length || state.date || state.price) && (
          <button type="button" onClick={clearAll} className="text-[11px] text-text-muted hover:text-text-secondary">Clear all</button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-card border border-border-subtle bg-bg-surface shadow-card md:block">
        <table className="min-w-full text-[13px]">
          <thead className="sticky top-0 bg-bg-surface-raised text-left text-text-muted">
            <tr>
              <Th onSort={() => toggleSort('date')} indicator={sortIndicator('date')} hasFilter={state.date !== undefined} onFilter={(el) => setOpenFilter({ key: 'date', anchor: el })}>Date</Th>
              <Th onSort={() => toggleSort('brand')} indicator={sortIndicator('brand')} hasFilter={state.brand.length > 0} onFilter={(el) => setOpenFilter({ key: 'brand', anchor: el })}>Brand</Th>
              <Th onSort={() => toggleSort('itemName')} indicator={sortIndicator('itemName')} hasFilter={state.subCategory.length > 0} onFilter={(el) => setOpenFilter({ key: 'subCategory', anchor: el })}>Item</Th>
              <Th onSort={() => toggleSort('category')} indicator={sortIndicator('category')} hasFilter={state.category.length > 0} onFilter={(el) => setOpenFilter({ key: 'category', anchor: el })}>Category</Th>
              <Th onSort={() => toggleSort('price')} indicator={sortIndicator('price')} hasFilter={state.price !== undefined} onFilter={(el) => setOpenFilter({ key: 'price', anchor: el })} className="text-right">Price</Th>
              <Th onSort={() => toggleSort('status')} indicator={sortIndicator('status')} hasFilter={state.status.length > 0} onFilter={(el) => setOpenFilter({ key: 'status', anchor: el })}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={`${r.orderId}-${r.itemName}-${i}`} className="border-t border-border-divider hover:bg-bg-surface-raised">
                <Td className="text-text-secondary">{shortDate(r.date)}</Td>
                <Td className="text-text-secondary">{r.brand}</Td>
                <Td>
                  <div className="font-medium text-text-primary">{r.productUrl ? (
                    <a href={r.productUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.itemName}</a>
                  ) : r.itemName}</div>
                  {r.subCategory && <div className="text-[11px] text-text-muted">{r.subCategory}</div>}
                </Td>
                <Td className="text-text-secondary">{r.category}</Td>
                <Td className="text-right tabular-nums text-text-primary">${r.price.toFixed(2)}</Td>
                <Td><StatusPill status={r.status as Status} /></Td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-text-muted">No matching items.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden">
        {sorted.length === 0 && <div className="rounded-card border border-border-subtle bg-bg-surface p-6 text-center text-text-muted">No matching items.</div>}
        {sorted.map((r, i) => (
          <a
            key={`${r.orderId}-${r.itemName}-${i}`}
            href={r.productUrl || '#'}
            target={r.productUrl ? '_blank' : undefined}
            rel="noopener noreferrer"
            className="mb-2 block rounded-card border border-border-divider bg-bg-surface p-3.5"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted">{r.brand}</span>
              <span className="text-[14px] font-bold tabular-nums text-text-primary">${r.price.toFixed(0)}</span>
            </div>
            <div className="mt-1 text-[14px] font-medium leading-snug text-text-primary">{r.itemName}</div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
              <span>{r.category || r.subCategory}</span>
              <span>·</span>
              <span>{shortDate(r.date)}</span>
              {r.status !== 'active' && <StatusPill status={r.status as Status} />}
            </div>
          </a>
        ))}
      </div>

      <ColumnFilterPopover open={openFilter !== null} onClose={() => setOpenFilter(null)} anchor={openFilter?.anchor ?? null}>
        {openFilter?.key === 'date' && (
          <DateFilterMenu value={state.date} onChange={(d) => { setState({ ...state, date: d }); setOpenFilter(null); }} yearsInData={years} />
        )}
        {openFilter?.key === 'price' && (
          <PriceFilterMenu value={state.price} onChange={(p) => { setState({ ...state, price: p }); setOpenFilter(null); }} />
        )}
        {openFilter?.key === 'brand' && (
          <TextFilter label="Brand" selected={state.brand} options={brands} onChange={(v) => setState({ ...state, brand: v })} />
        )}
        {openFilter?.key === 'subCategory' && (
          <TextFilter label="Sub-category" selected={state.subCategory} options={subCats} onChange={(v) => setState({ ...state, subCategory: v })} />
        )}
        {openFilter?.key === 'category' && (
          <TextFilter label="Category" selected={state.category} options={categories} onChange={(v) => setState({ ...state, category: v })} />
        )}
        {openFilter?.key === 'status' && (
          <EnumFilter label="Status" selected={state.status} options={STATUS_VALUES} onChange={(v) => setState({ ...state, status: v })} />
        )}
      </ColumnFilterPopover>
    </div>
  );
}

function Th({
  children, onSort, indicator = '', hasFilter, onFilter, className = '',
}: {
  children: React.ReactNode;
  onSort: () => void;
  indicator?: string;
  hasFilter: boolean;
  onFilter: (anchor: HTMLElement) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <th className={`group px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${className}`}>
      <div ref={ref} className="flex items-center gap-1.5">
        <button type="button" onClick={onSort} className="hover:text-text-primary">{children}{indicator}</button>
        {hasFilter && <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-gradient shadow-accent-glow" />}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); if (ref.current) onFilter(ref.current); }}
          className="opacity-0 transition group-hover:opacity-100 hover:text-text-primary"
          aria-label="Filter column"
        >▾</button>
      </div>
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

function uniqueSorted(values: readonly string[]): string[] {
  const set = new Set<string>();
  for (const v of values) if (v) set.add(v);
  return Array.from(set).sort();
}

function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function activeFilterChips(state: ReturnType<typeof useTableFilters>['state'], setState: ReturnType<typeof useTableFilters>['setState']) {
  const chips: React.ReactNode[] = [];
  for (const s of state.status) {
    chips.push(<ActiveFilterChip key={`status-${s}`} label={`Status: ${s}`} onRemove={() => setState({ ...state, status: state.status.filter((x) => x !== s) })} />);
  }
  for (const b of state.brand) {
    chips.push(<ActiveFilterChip key={`brand-${b}`} label={`Brand: ${b}`} onRemove={() => setState({ ...state, brand: state.brand.filter((x) => x !== b) })} />);
  }
  for (const c of state.category) {
    chips.push(<ActiveFilterChip key={`cat-${c}`} label={`Category: ${c}`} onRemove={() => setState({ ...state, category: state.category.filter((x) => x !== c) })} />);
  }
  for (const sc of state.subCategory) {
    chips.push(<ActiveFilterChip key={`sub-${sc}`} label={`Sub: ${sc}`} onRemove={() => setState({ ...state, subCategory: state.subCategory.filter((x) => x !== sc) })} />);
  }
  if (state.date) {
    chips.push(<ActiveFilterChip key="date" label={`Date: ${dateLabel(state.date)}`} onRemove={() => setState({ ...state, date: undefined })} />);
  }
  if (state.price) {
    chips.push(<ActiveFilterChip key="price" label={`Price: ${priceLabel(state.price)}`} onRemove={() => setState({ ...state, price: undefined })} />);
  }
  return chips;
}

function dateLabel(d: NonNullable<ReturnType<typeof useTableFilters>['state']['date']>): string {
  switch (d.kind) {
    case 'preset': return d.value.replace(/-/g, ' ');
    case 'year': return String(d.value);
    case 'month': return `${d.year}-${String(d.month).padStart(2,'0')}`;
    case 'range': return `${d.start} → ${d.end}`;
  }
}

function priceLabel(p: NonNullable<ReturnType<typeof useTableFilters>['state']['price']>): string {
  switch (p.kind) {
    case 'gte': return `≥ $${p.value}`;
    case 'lte': return `≤ $${p.value}`;
    case 'range': return `$${p.min}–$${p.max}`;
  }
}
```

Note: this file imports `STATUS_VALUES`, `DOMAIN_VALUES`, `ITEM_TYPE_VALUES` from `lib/types.js` — those already exist (verified during planning).

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/components/items-table.tsx
git commit -m "feat(web): refactor items table — chip toolbar, header-dropdown filters, mobile cards"
```

---

## Task 14: Wire-up home page with KPI strip

**Files:**
- Modify: `app/page.tsx`

The home page needs to fetch KPIs server-side (it needs both master rows AND the needs-review count), then render crumb + H1 + meta + KPI strip + ItemsTable. The KPI strip is a Server Component that passes computed values to the KpiCard client component (KpiCard is actually a pure render so it can render on the server too).

- [ ] **Step 1: Replace `app/page.tsx`**

Overwrite `app/page.tsx`:

```tsx
import { getMasterRows, getNeedsReviewRows } from './lib/data';
import { computeKpis } from './lib/kpi';
import { ItemsTable } from './components/items-table';
import { KpiCard } from './components/kpi-card';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [rows, needsReview] = await Promise.all([
    getMasterRows(),
    getNeedsReviewRows(),
  ]);
  const unresolved = needsReview.filter((r) => !r.resolved).length;
  const kpis = computeKpis(rows, unresolved, new Date());
  const activeCount = rows.filter((r) => r.status === 'active').length;

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      {/* Atmospheric gradient blob */}
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />

      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Inventory</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Items</h1>
        <p className="text-[13px] text-text-secondary">{activeCount} active items · {rows.length} total</p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard
            label="Active spend"
            value={`$${kpis.activeSpend.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
            delta={kpis.activeSpend.delta !== 0
              ? { value: `$${Math.abs(kpis.activeSpend.delta).toFixed(0)} vs same month '${String(new Date().getUTCFullYear() - 1).slice(2)}`, direction: kpis.activeSpend.delta >= 0 ? 'up' : 'down' }
              : undefined}
          />
          <KpiCard
            label="Items YTD"
            value={String(kpis.itemsYtd.value)}
            delta={kpis.itemsYtd.delta !== 0
              ? { value: `${Math.abs(kpis.itemsYtd.delta)} vs '${String(new Date().getUTCFullYear() - 1).slice(2)}`, direction: kpis.itemsYtd.delta >= 0 ? 'up' : 'down' }
              : undefined}
          />
          <KpiCard
            label="Needs review"
            value={String(kpis.needsReview.value)}
            href="/needs-review"
          />
        </div>

        <div className="mt-6">
          <ItemsTable rows={rows} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Run dev server, verify desktop view**

Run: `npm run web:dev`
Open: `http://localhost:3000` (you'll need to provide WEB_USER/WEB_PASSWORD if middleware is enforced; check `.env.local` or set them to anything for dev).

Verify:
- Sidebar visible on the left (≥768px viewport), brand mark with gradient, Domains group + Everything group + Agent group present.
- Page header shows "Items" with metadata and crumb.
- 3 KPI cards visible.
- Items table renders with sticky column headers, gradient-dot column filter indicators on filtered columns, comfortable row height (~56px).
- Hovering a column header reveals a `▾` icon. Clicking it opens a popover with the appropriate filter content.
- Date filter: typing "last 90 days" then Enter applies; preset chips also work.
- Active filters appear as chips at top with × to remove.
- URL updates as filters change (e.g., `?status=active&date=last-90-days`).

Stop dev server (Ctrl+C) when done verifying.

- [ ] **Step 4: Verify mobile view**

Restart dev server: `npm run web:dev`
Open browser dev tools, switch to mobile viewport (375px width). Verify:
- Sidebar hidden; hamburger button visible top-left
- Tapping hamburger opens drawer with backdrop; tapping backdrop closes it
- KPI strip stacks (or scrolls horizontally if there's overflow)
- Items render as cards (not table)
- Cards show brand · price · name · sub-category + date; non-active items show a status badge

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(web): home page with KPI strip + new items table"
```

---

## Task 15: Spending page restyle

**Files:**
- Modify: `app/spending/page.tsx`
- Modify: `app/components/spending-charts.tsx`

Re-skin to new palette. Same chart structures.

- [ ] **Step 1: Update `app/spending/page.tsx`**

Overwrite `app/spending/page.tsx`:

```tsx
import { getMasterRows, getNeedsReviewRows } from '../lib/data';
import { computeKpis } from '../lib/kpi';
import { SpendingCharts } from '../components/spending-charts';
import { KpiCard } from '../components/kpi-card';

export const dynamic = 'force-dynamic';

export default async function SpendingPage() {
  const [rows, needsReview] = await Promise.all([
    getMasterRows(),
    getNeedsReviewRows(),
  ]);
  const kept = rows.filter((r) => r.status !== 'returned' && r.status !== 'excluded');
  const kpis = computeKpis(rows, needsReview.filter((r) => !r.resolved).length, new Date());
  const total = kept.reduce((s, r) => s + (r.price || 0), 0);

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />
      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Inventory</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Spending</h1>
        <p className="text-[13px] text-text-secondary">${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} across {kept.length} kept items</p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard label="Active spend" value={`$${kpis.activeSpend.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
          <KpiCard label="Items YTD" value={String(kpis.itemsYtd.value)} />
          <KpiCard label="Needs review" value={String(kpis.needsReview.value)} href="/needs-review" />
        </div>

        <div className="mt-6">
          <SpendingCharts rows={kept} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `app/components/spending-charts.tsx`**

Overwrite `app/components/spending-charts.tsx`:

```tsx
'use client';
import { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import type { MasterRow } from '../../lib/types.js';

const PALETTE = ['#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#fb923c', '#c4b5fd', '#fda4af'];

export function SpendingCharts({ rows }: { rows: MasterRow[] }) {
  const byYear = useMemo(() => aggregateBy(rows, (r) => r.year), [rows]);
  const byDomain = useMemo(() => aggregateBy(rows, (r) => r.domain || 'Other'), [rows]);
  const byCategory = useMemo(() => aggregateBy(rows, (r) => r.category || 'Uncategorized').slice(0, 10), [rows]);
  const byBrand = useMemo(() => aggregateBy(rows, (r) => r.brand || 'Unknown').slice(0, 10), [rows]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartCard title="Total spend by year">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={byYear}>
            <CartesianGrid strokeDasharray="3 3" stroke="#211e3a" />
            <XAxis dataKey="name" stroke="#a09cb8" tick={{ fontSize: 12 }} />
            <YAxis stroke="#a09cb8" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="url(#barGradient)" radius={[6, 6, 0, 0]} />
            <defs>
              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f472b6" />
                <stop offset="100%" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Spend by domain">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={byDomain} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2}>
              {byDomain.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#a09cb8' }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 categories">
        <ResponsiveContainer width="100%" height={Math.max(220, byCategory.length * 28)}>
          <BarChart data={byCategory} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#211e3a" />
            <XAxis type="number" stroke="#a09cb8" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <YAxis type="category" dataKey="name" stroke="#a09cb8" tick={{ fontSize: 12 }} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#a78bfa" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 brands">
        <ResponsiveContainer width="100%" height={Math.max(220, byBrand.length * 28)}>
          <BarChart data={byBrand} layout="vertical" margin={{ left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#211e3a" />
            <XAxis type="number" stroke="#a09cb8" tick={{ fontSize: 12 }} tickFormatter={fmtUsdShort} />
            <YAxis type="category" dataKey="name" stroke="#a09cb8" tick={{ fontSize: 12 }} width={110} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtUsd(v)} />
            <Bar dataKey="value" fill="#f472b6" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border-subtle bg-bg-surface p-4 shadow-card">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{title}</h2>
      {children}
    </div>
  );
}

function aggregateBy(rows: MasterRow[], keyFn: (r: MasterRow) => string): { name: string; value: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const key = keyFn(r);
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + (r.price || 0));
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
}

function fmtUsd(v: number): string { return `$${v.toFixed(2)}`; }
function fmtUsdShort(v: number): string { if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`; return `$${v}`; }

const tooltipStyle = {
  contentStyle: { backgroundColor: '#16142a', border: '1px solid #211e3a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#fafafa' },
  itemStyle: { color: '#e2e0eb' },
};
```

- [ ] **Step 3: Verify in dev server**

Run: `npm run web:dev`
Open: `http://localhost:3000/spending`
Verify: page renders with new palette, charts use purple-pink gradient for bars, dark surface cards, KPI strip on top. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/spending/page.tsx app/components/spending-charts.tsx
git commit -m "feat(web): restyle Spending page to new palette"
```

---

## Task 16: Needs Review page restyle

**Files:**
- Modify: `app/needs-review/page.tsx`
- Modify: `app/components/needs-review-table.tsx`

- [ ] **Step 1: Update `app/needs-review/page.tsx`**

Overwrite `app/needs-review/page.tsx`:

```tsx
import { getMasterRows, getNeedsReviewRows } from '../lib/data';
import { computeKpis } from '../lib/kpi';
import { NeedsReviewTable } from '../components/needs-review-table';
import { KpiCard } from '../components/kpi-card';

export const dynamic = 'force-dynamic';

export default async function NeedsReviewPage() {
  const [rows, all] = await Promise.all([
    getMasterRows(),
    getNeedsReviewRows(),
  ]);
  const unresolved = all.filter((r) => !r.resolved);
  const kpis = computeKpis(rows, unresolved.length, new Date());

  return (
    <div className="relative overflow-hidden px-4 py-6 md:px-7">
      <div className="pointer-events-none absolute -right-20 -top-20 h-[280px] w-[280px] rounded-full bg-blob-gradient opacity-[0.18] blur-[40px]" />
      <div className="relative">
        <div className="text-[11px] uppercase tracking-[0.05em] text-text-muted">Inventory</div>
        <h1 className="mt-1 text-[26px] font-bold tracking-[-0.02em] text-text-primary">Needs review</h1>
        <p className="text-[13px] text-text-secondary">{unresolved.length} unresolved · {all.length} total in the sheet</p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <KpiCard label="Active spend" value={`$${kpis.activeSpend.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
          <KpiCard label="Items YTD" value={String(kpis.itemsYtd.value)} />
          <KpiCard label="Needs review" value={String(kpis.needsReview.value)} />
        </div>

        <div className="mt-6">
          <NeedsReviewTable rows={all} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `app/components/needs-review-table.tsx`**

Overwrite `app/components/needs-review-table.tsx`:

```tsx
'use client';
import { useState, useMemo } from 'react';
import type { NeedsReviewRow } from '../lib/data';

export function NeedsReviewTable({ rows }: { rows: NeedsReviewRow[] }) {
  const [showResolved, setShowResolved] = useState(false);
  const visible = useMemo(
    () => showResolved ? rows : rows.filter((r) => !r.resolved),
    [rows, showResolved],
  );
  return (
    <div>
      <label className="mb-3 inline-flex cursor-pointer items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)}
          className="accent-accent-from"
        />
        Show resolved
      </label>
      <div className="overflow-hidden rounded-card border border-border-subtle bg-bg-surface shadow-card">
        <table className="min-w-full text-[13px]">
          <thead className="bg-bg-surface-raised text-left text-text-muted">
            <tr>
              <Th>Detected</Th>
              <Th>Source</Th>
              <Th>Subject</Th>
              <Th>Reason</Th>
              <Th>Excerpt</Th>
              <Th>Resolved</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.gmailMessageId || `${r.dateDetected}-${r.emailSubject}`}
                  className={`border-t border-border-divider hover:bg-bg-surface-raised ${r.resolved ? 'opacity-50' : ''}`}>
                <Td className="whitespace-nowrap text-text-secondary">{shortDate(r.dateDetected)}</Td>
                <Td className="text-text-secondary">{r.source}</Td>
                <Td className="max-w-md truncate text-text-primary" title={r.emailSubject}>{r.emailSubject}</Td>
                <Td><ReasonPill reason={r.reason} /></Td>
                <Td className="max-w-md truncate text-text-secondary" title={r.rawExcerpt}>{r.rawExcerpt}</Td>
                <Td>{r.resolved ? '✓' : '—'}</Td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                {rows.length === 0 ? 'Needs Review tab is empty.' : 'No unresolved rows.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em]">{children}</th>;
}
function Td({ children, className = '', title }: { children: React.ReactNode; className?: string; title?: string }) {
  const props = title ? { title } : {};
  return <td className={`px-4 py-3 ${className}`} {...props}>{children}</td>;
}
function shortDate(iso: string): string { return iso.slice(0, 10); }
function ReasonPill({ reason }: { reason: string }) {
  const styles = reason.includes('parse')
    ? 'text-status-broken-fg bg-status-broken-bg'
    : reason.includes('low')
      ? 'text-status-returned-fg bg-status-returned-bg'
      : 'text-text-secondary bg-bg-surface-raised';
  return (
    <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-[10px] font-semibold ${styles}`}>
      {reason || 'unknown'}
    </span>
  );
}
```

- [ ] **Step 3: Verify in dev server**

Run: `npm run web:dev`
Open: `http://localhost:3000/needs-review`
Verify palette applied, table styled, KPI strip present. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add app/needs-review/page.tsx app/components/needs-review-table.tsx
git commit -m "feat(web): restyle Needs Review page to new palette"
```

---

## Task 17: Final acceptance pass

**Files:** none modified (verification only)

- [ ] **Step 1: Typecheck + tests both clean**

Run: `npm run typecheck && npm run test`
Expected: both pass with no errors.

- [ ] **Step 2: Build succeeds**

Run: `npm run web:build`
Expected: Next.js build completes with no errors. Note any warnings.

- [ ] **Step 3: Manual acceptance — desktop**

Run: `npm run web:dev`
Open `http://localhost:3000` at desktop width. Walk through:

- [ ] Sidebar shows all sections (Domains, Everything, Agent), Outdoor marked active
- [ ] Click `Kitchen` → URL becomes `/?domain=kitchen`, sidebar updates active state
- [ ] Click `All items` → domain cleared
- [ ] KPI strip shows three cards with values and at least one delta
- [ ] Items table has sticky column headers — they stay visible when scrolling
- [ ] Hover a column header → `▾` icon appears; click it → popover opens beneath
- [ ] Type "last 90 days" into Date filter input + Enter → URL updates `?date=last-90-days`, rows filter, chip appears in toolbar
- [ ] Click × on the date chip → filter removed, URL updated
- [ ] Refresh page with `?date=last-90-days&status=active` → both filters restore
- [ ] Click a status pill column header → enum filter opens with checkboxes
- [ ] Sort: clicking column header (not the ▾) cycles sort direction
- [ ] Filtered count `N of M` in top-right updates live
- [ ] Item-name click opens product URL in new tab
- [ ] Navigate to /spending → new palette, gradient bars
- [ ] Navigate to /needs-review → new palette, table styled

- [ ] **Step 4: Manual acceptance — mobile (375px)**

Same dev server, switch viewport to 375px. Walk through:

- [ ] Sidebar hidden; hamburger top-left
- [ ] Tap hamburger → drawer slides in
- [ ] Tap backdrop → drawer closes
- [ ] Items render as cards, not table
- [ ] Card with non-active status shows the status pill at the bottom
- [ ] KPI strip is visible (either stacked or horizontally scrolling)
- [ ] Tap a card → opens product URL in new tab

Stop dev server when done.

- [ ] **Step 5: Final commit if any small fixes were needed**

If any visual issues were caught and fixed during acceptance, commit them now:

```bash
git status
git add -p   # selectively add changes
git commit -m "fix(web): minor visual fixes from acceptance pass"
```

Otherwise nothing to commit.

- [ ] **Step 6: Done**

The redesign is shipped. Push to deploy:

```bash
git push origin main
```

(Railway will redeploy the Web service automatically.)
