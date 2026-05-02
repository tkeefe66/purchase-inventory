import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAmazonEmail } from '../../lib/parsers/amazon.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/amazon');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('parseAmazonEmail', () => {
  test('extracts a single Order ID from a shipment-tracking email', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonEmail(html);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]!.orderId).toBe('114-4360051-0313822');
    expect(result![0]!.source).toBe('Amazon');
  });

  test('returns null for an order-confirmation email (no per-item prices to ingest)', () => {
    const html = loadFixture(
      '1967d7a54e6a90c4__Ordered-_-Insta360_Bullet_Time_Bundle...-_and_1_more_item.html',
    );
    expect(parseAmazonEmail(html)).toBeNull();
  });

  test('extracts the line item from a single-item shipment (Sony camera)', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonEmail(html);
    expect(result![0]!.items).toHaveLength(1);
    const item = result![0]!.items[0]!;
    expect(item.itemName).toMatch(/^Sony Alpha a6700 Mirrorless Camera/);
    expect(item.quantity).toBe(1);
    expect(item.price).toBe(1498.0);
    expect(item.productUrl).toMatch(/^https?:\/\//);
  });

  test('ignores "Continue shopping deals" recommendations (not real ordered items)', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonEmail(html);
    // Sony shipment has 1 real item + 3 ads (Anker x2, Coleman). Parser should return 1.
    expect(result![0]!.items).toHaveLength(1);
    const allItemNames = result![0]!.items.map((i) => i.itemName);
    expect(allItemNames.some((n) => n.includes('Anker'))).toBe(false);
    expect(allItemNames.some((n) => n.includes('Coleman'))).toBe(false);
  });
});
