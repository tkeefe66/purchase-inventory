import { describe, test, expect } from 'vitest';
import { serializeCompact } from '../../../domains/photography/serialize.js';
import {
  FIXTURE_PHOTO_ALL,
  FIXTURE_SONY_A6700,
  FIXTURE_SIGMA_18_50,
  FIXTURE_ET8550,
  FIXTURE_LIGHTROOM,
  FIXTURE_BATTERIES,
  FIXTURE_PHOTO_RETIRED,
  FIXTURE_OUTDOOR_ACTIVE,
  FIXTURE_KITCHEN_ACTIVE,
} from '../../fixtures/photography-items.js';

describe('serializeCompact (photography)', () => {
  test('renders header with active-only note and total row count', () => {
    const out = serializeCompact([FIXTURE_SONY_A6700]);
    expect(out.text).toContain('=== ACTIVE PHOTOGRAPHY INVENTORY ===');
    expect(out.text).toContain('Total rows: 1');
    expect(out.text).toContain('Only items with status=active are shown');
  });

  test('header text mentions photography', () => {
    const out = serializeCompact([FIXTURE_SONY_A6700]);
    expect(out.text.toLowerCase()).toContain('photography');
  });

  test('filters out retired Photography rows', () => {
    const out = serializeCompact(FIXTURE_PHOTO_ALL);
    expect(out.text).not.toContain('Old 55-210mm Kit Lens');
  });

  test('filters out active Outdoor rows', () => {
    const out = serializeCompact(FIXTURE_PHOTO_ALL);
    expect(out.text).not.toContain('Z Lite Sol Sleeping Pad');
    expect(out.text).not.toContain('Therm-a-Rest');
  });

  test('filters out active Kitchen rows', () => {
    const out = serializeCompact(FIXTURE_PHOTO_ALL);
    expect(out.text).not.toContain('All-Clad');
    expect(out.text).not.toContain('Fry Pan');
  });

  test('includes all active Photography rows in count', () => {
    const out = serializeCompact(FIXTURE_PHOTO_ALL);
    // 5 active photography rows: Sony, Sigma, ET8550, Lightroom, Batteries
    expect(out.text).toContain('Total rows: 5');
  });

  test('renders a Gear row with brand, item name, year, price, category, and type', () => {
    const out = serializeCompact([FIXTURE_SIGMA_18_50]);
    expect(out.text).toContain('Sigma');
    expect(out.text).toContain('18-50mm f/2.8 DC DN Contemporary');
    expect(out.text).toContain('2024');
    expect(out.text).toContain('$549');
    expect(out.text).toContain('Camera Lenses/Zoom');
    expect(out.text).toContain('Gear');
  });

  test('renders a Service row with type=Service', () => {
    const out = serializeCompact([FIXTURE_LIGHTROOM]);
    expect(out.text).toContain('Service');
    expect(out.text).toContain('Adobe');
    expect(out.text).toContain('Lightroom Classic Annual Plan');
  });

  test('renders a Consumable row with type=Consumable', () => {
    const out = serializeCompact([FIXTURE_BATTERIES]);
    expect(out.text).toContain('Consumable');
    expect(out.text).toContain('NP-FZ100 Battery');
  });

  test('includes type in bracket with category', () => {
    const out = serializeCompact([FIXTURE_SIGMA_18_50]);
    expect(out.text).toContain('[Camera Lenses/Zoom, Gear]');
  });

  test('renders category-only (no sub-category) when subCategory is blank', () => {
    const noSub = { ...FIXTURE_SIGMA_18_50, subCategory: '' };
    const out = serializeCompact([noSub]);
    expect(out.text).toContain('[Camera Lenses, Gear]');
    expect(out.text).not.toContain('[Camera Lenses/, Gear]');
  });

  test('renders color and size when present', () => {
    const withColor = { ...FIXTURE_SONY_A6700 };
    const out = serializeCompact([withColor]);
    expect(out.text).toContain('(Black)');
  });

  test('omits color/size parens when both blank', () => {
    const out = serializeCompact([FIXTURE_SIGMA_18_50]);
    expect(out.text).not.toMatch(/18-50mm.*\(/);
  });

  test('prefixes each row with its 6-char itemId in brackets', () => {
    const out = serializeCompact([FIXTURE_SONY_A6700]);
    expect(out.text).toMatch(/\n\[[0-9a-z]{6}\] \| 2024 \| Sony/);
  });

  test('includes product URL in each row', () => {
    const out = serializeCompact([FIXTURE_SONY_A6700]);
    expect(out.text).toContain(FIXTURE_SONY_A6700.productUrl);
  });

  test('hash is stable across two identical inputs', () => {
    const a = serializeCompact([FIXTURE_SONY_A6700, FIXTURE_SIGMA_18_50]);
    const b = serializeCompact([FIXTURE_SIGMA_18_50, FIXTURE_SONY_A6700]);
    expect(a.text).toBe(b.text);
    expect(a.hash).toBe(b.hash);
  });

  test('hash changes when an item is added', () => {
    const a = serializeCompact([FIXTURE_SONY_A6700]);
    const b = serializeCompact([FIXTURE_SONY_A6700, FIXTURE_SIGMA_18_50]);
    expect(a.hash).not.toBe(b.hash);
  });

  test('returns a 64-char hex SHA-256 hash', () => {
    const out = serializeCompact([FIXTURE_SONY_A6700]);
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('produces a different hash when row data changes', () => {
    const a = serializeCompact([FIXTURE_SONY_A6700]);
    const variant = { ...FIXTURE_SONY_A6700, price: 1199 };
    const b = serializeCompact([variant]);
    expect(a.hash).not.toBe(b.hash);
  });

  test('handles empty input gracefully', () => {
    const out = serializeCompact([]);
    expect(out.text).toContain('Total rows: 0');
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('formats decimal price correctly', () => {
    const out = serializeCompact([FIXTURE_ET8550]);
    expect(out.text).toContain('$699.99');
  });

  test('formats whole-number price without decimal', () => {
    const out = serializeCompact([FIXTURE_SIGMA_18_50]);
    expect(out.text).toContain('$549 ');
  });
});
