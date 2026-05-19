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
