import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseReiEmail, parseReiReceiptEmail } from '../../lib/parsers/rei.js';

// REI fixtures live in tests/fixtures/rei/ (not the top-level fixtures dir)
const FIXTURES = join(process.cwd(), 'tests/fixtures/rei');

function loadOneFixture(substring: string): string {
  const file = readdirSync(FIXTURES).find(
    (f) => f.includes(substring) && f.endsWith('.html'),
  );
  if (!file) throw new Error(`No fixture containing "${substring}" found in ${FIXTURES}`);
  return readFileSync(join(FIXTURES, file), 'utf-8');
}

describe('parseReiEmail image extraction', () => {
  it('attaches an imageUrl pointing at images.rei.com/skuimage for each item', () => {
    // Uses an online order-confirmation fixture (Thanks_for_your_order)
    const html = loadOneFixture('Thanks_for_your_order!_(A398129839)');
    const order = parseReiEmail(html);
    expect(order).not.toBeNull();
    expect(order!.items.length).toBeGreaterThan(0);
    for (const item of order!.items) {
      expect(item.imageUrl).toBeTruthy();
      expect(item.imageUrl).toMatch(/rei\.com\/.*skuimage/);
    }
  });
});

describe('parseReiReceiptEmail image extraction', () => {
  it('attaches an imageUrl per line item from the in-store eReceipt', () => {
    // Uses a store eReceipt fixture
    const html = loadOneFixture('Your_REI_eReceipt');
    const order = parseReiReceiptEmail(html);
    expect(order).not.toBeNull();
    for (const item of order!.items) {
      expect(item.imageUrl).toBeTruthy();
      expect(item.imageUrl).toMatch(/rei\.com\/.*skuimage/);
    }
  });
});
