import { describe, test, expect } from 'vitest';
import { serializeCompact } from '../../../domains/outdoor/serialize.js';
import {
  FIXTURE_ALL,
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
  FIXTURE_NO_BRAND,
} from '../../fixtures/outdoor-items.js';

describe('serializeCompact', () => {
  test('renders header with active-only note and total row count', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.text).toContain('=== ACTIVE OUTDOOR INVENTORY ===');
    expect(out.text).toContain('Total rows: 1');
    expect(out.text).toContain('Only items with status=active are shown');
  });

  test('filters out non-Outdoor rows', () => {
    const out = serializeCompact(FIXTURE_ALL);
    expect(out.text).not.toContain('Sigma');
  });

  test('filters out non-active rows', () => {
    const out = serializeCompact(FIXTURE_ALL);
    expect(out.text).not.toContain('Old Backpack');
  });

  test('renders a row with brand, color, and size', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.text).toContain(
      '| 2026 | Therm-a-Rest Z Lite Sol Sleeping Pad (Limon, Reg) | $49.95 [Camping Gear/Sleep System]',
    );
  });

  test('renders a row without a brand (no leading space)', () => {
    const out = serializeCompact([FIXTURE_NO_BRAND]);
    expect(out.text).toContain(
      '| 2026 | 12 Pack Tent Stake with Hammer | $19.99 [Camping Gear/Camp Accessories]',
    );
  });

  test('omits color/size parens when both blank', () => {
    const out = serializeCompact([FIXTURE_NO_BRAND]);
    expect(out.text).not.toMatch(/12 Pack Tent Stake with Hammer\s*\(/);
  });

  test('renders only category when sub-category is blank', () => {
    const onlyCat = { ...FIXTURE_NO_BRAND, subCategory: '' };
    const out = serializeCompact([onlyCat]);
    expect(out.text).toContain('[Camping Gear]');
    expect(out.text).not.toContain('[Camping Gear/]');
  });

  test('prefixes each row with its 6-char itemId in brackets', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.text).toMatch(/\n\[[0-9a-z]{6}\] \| 2026 \| Therm-a-Rest/);
  });

  test('sorts rows by category, then year desc, then itemName for hash stability', () => {
    const a = serializeCompact([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    const b = serializeCompact([FIXTURE_SALOMON, FIXTURE_THERMAREST]);
    expect(a.text).toBe(b.text);
    expect(a.hash).toBe(b.hash);
  });

  test('returns a 64-char hex SHA-256 hash', () => {
    const out = serializeCompact([FIXTURE_THERMAREST]);
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produces a different hash when row data changes', () => {
    const a = serializeCompact([FIXTURE_THERMAREST]);
    const variant = { ...FIXTURE_THERMAREST, price: 59.95 };
    const b = serializeCompact([variant]);
    expect(a.hash).not.toBe(b.hash);
  });

  test('produces the same hash when only ignored fields change', () => {
    const a = serializeCompact([FIXTURE_THERMAREST]);
    const variant = { ...FIXTURE_THERMAREST, reasoning: 'changed' };
    const b = serializeCompact([variant]);
    expect(a.hash).toBe(b.hash);
  });

  test('handles empty input gracefully', () => {
    const out = serializeCompact([]);
    expect(out.text).toContain('Total rows: 0');
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
