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
  color: string[];
  size: string[];
  source: string[];
  entryMethod: string[];
  date: DateFilter | undefined;
  price: PriceFilter | undefined;
}

function getMultiValue(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export function parseFilterState(params: URLSearchParams): FilterState {
  return {
    q: params.get('q') ?? '',
    domain: params.get('domain') ?? '',
    status: getMultiValue(params, 'status'),
    brand: getMultiValue(params, 'brand'),
    category: getMultiValue(params, 'category'),
    subCategory: getMultiValue(params, 'subCategory'),
    type: getMultiValue(params, 'type'),
    year: getMultiValue(params, 'year'),
    color: getMultiValue(params, 'color'),
    size: getMultiValue(params, 'size'),
    source: getMultiValue(params, 'source'),
    entryMethod: getMultiValue(params, 'entryMethod'),
    date: parseDate(params.get('date')),
    price: parsePrice(params.get('price')),
  };
}

export function serializeFilterState(state: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.domain) p.set('domain', state.domain);
  if (state.status.length) p.set('status', state.status.join(','));
  if (state.brand.length) p.set('brand', state.brand.join(','));
  if (state.category.length) p.set('category', state.category.join(','));
  if (state.subCategory.length) p.set('subCategory', state.subCategory.join(','));
  if (state.type.length) p.set('type', state.type.join(','));
  if (state.year.length) p.set('year', state.year.join(','));
  if (state.color.length) p.set('color', state.color.join(','));
  if (state.size.length) p.set('size', state.size.join(','));
  if (state.source.length) p.set('source', state.source.join(','));
  if (state.entryMethod.length) p.set('entryMethod', state.entryMethod.join(','));
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
    default: {
      const _exhaustive: never = d;
      return _exhaustive;
    }
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
    if (minStr && maxStr) {
      const min = Number(minStr);
      const max = Number(maxStr);
      if (Number.isFinite(min) && Number.isFinite(max)) return { kind: 'range', min, max };
    }
  }
  return undefined;
}

function serializePrice(p: PriceFilter | undefined): string | null {
  if (!p) return null;
  switch (p.kind) {
    case 'gte': return `gte:${p.value}`;
    case 'lte': return `lte:${p.value}`;
    case 'range': return `range:${p.min}:${p.max}`;
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}
