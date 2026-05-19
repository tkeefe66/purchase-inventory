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
