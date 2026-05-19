import { describe, it, expect } from 'vitest';
import { computeKpis } from '../../../app/lib/kpi.js';
import type { MasterRow } from '../../../lib/types.js';

function row(p: Partial<MasterRow>): MasterRow {
  return {
    year: '', date: '', category: '', subCategory: '', brand: '', itemName: '',
    color: '', size: '', qty: 1, price: 0, source: 'Other', orderId: '',
    status: 'active', domain: 'Outdoor', productUrl: '', type: 'Gear',
    reasoning: '', notes: '', image: '',
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

  it('ignores rows with malformed dates', () => {
    const rows = [
      row({ date: '2026-05-01', status: 'active' }),
      row({ date: '2026-13-45', status: 'active' }),  // invalid month + day
      row({ date: 'garbage', status: 'active' }),
      row({ date: '', status: 'active' }),  // empty
    ];
    const k = computeKpis(rows, 0, new Date('2026-05-18'));
    expect(k.itemsYtd.value).toBe(1);  // only the valid 2026-05-01 row
  });

  it('handles empty rows', () => {
    const k = computeKpis([], 0, new Date('2026-05-18'));
    expect(k.activeSpend.value).toBe(0);
    expect(k.itemsYtd.value).toBe(0);
    expect(k.needsReview.value).toBe(0);
  });
});
