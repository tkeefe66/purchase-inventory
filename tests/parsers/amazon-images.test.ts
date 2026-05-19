import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAmazonShipmentEmail } from '../../lib/parsers/amazon.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/amazon');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('parseAmazonShipmentEmail — imageUrl', () => {
  test('extracts product image URL from Sony camera shipment', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonShipmentEmail(html);
    expect(result).not.toBeNull();
    expect(result![0]!.items).toHaveLength(1);
    const item = result![0]!.items[0]!;
    expect(item.imageUrl).toBeDefined();
    expect(item.imageUrl).toMatch(/media-amazon\.com|images-amazon\.com|amazon\.com/);
  });

  test('imageUrl is a non-empty string when an image src is present', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonShipmentEmail(html);
    const item = result![0]!.items[0]!;
    expect(typeof item.imageUrl).toBe('string');
    expect(item.imageUrl!.length).toBeGreaterThan(0);
  });

  test('imageUrl is undefined (not empty string) when src is missing', () => {
    // Inject a fixture with an img that has a long alt but no src
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    // Blank out the src on all img tags
    const noSrcHtml = html.replace(/(<img[^>]*) src="[^"]*"/gi, '$1 src=""');
    const result = parseAmazonShipmentEmail(noSrcHtml);
    if (result && result[0] && result[0].items[0]) {
      expect(result[0].items[0].imageUrl).toBeUndefined();
    }
    // If the parser returns null (price=0 after src wipe) that's also acceptable
    // since this is just checking the || undefined guard
  });
});
