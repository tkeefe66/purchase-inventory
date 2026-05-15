import { describe, test, expect } from 'vitest';
import { extractProductId } from '../../lib/productId.js';

describe('extractProductId', () => {
  test('Amazon /dp/ASIN', () => {
    expect(extractProductId('https://www.amazon.com/dp/B0CHX1W1XY')).toBe('amzn:B0CHX1W1XY');
  });

  test('Amazon /gp/product/ASIN', () => {
    expect(extractProductId('https://amazon.com/gp/product/B0CHX1W1XY')).toBe('amzn:B0CHX1W1XY');
  });

  test('Amazon with slug before /dp/', () => {
    expect(
      extractProductId('https://www.amazon.com/Forbidden-Road-380T-Nylon-Portable/dp/B072WQ8BJW'),
    ).toBe('amzn:B072WQ8BJW');
  });

  test('Amazon with query string', () => {
    expect(
      extractProductId('https://www.amazon.com/dp/B0CHX1W1XY?ref=ppx&th=1'),
    ).toBe('amzn:B0CHX1W1XY');
  });

  test('Amazon mobile /gp/aw/d/', () => {
    expect(extractProductId('https://www.amazon.com/gp/aw/d/B0CHX1W1XY')).toBe('amzn:B0CHX1W1XY');
  });

  test('REI /product/<numeric>/<slug>', () => {
    expect(
      extractProductId('https://www.rei.com/product/163187/grass-sticks-original-bamboo-ski-poles-pair'),
    ).toBe('rei:163187');
  });

  test('REI with section prefix', () => {
    expect(
      extractProductId('https://www.rei.com/rei-garage/product/123456/some-item'),
    ).toBe('rei:123456');
  });

  test('returns null for an unrecognized URL', () => {
    expect(extractProductId('https://example.com/whatever')).toBeNull();
  });

  test('returns null for empty / whitespace input', () => {
    expect(extractProductId('')).toBeNull();
    expect(extractProductId('   ')).toBeNull();
  });

  test('Amazon ASIN is upper-cased for canonical form', () => {
    expect(extractProductId('https://amazon.com/dp/b0chx1w1xy')).toBe('amzn:B0CHX1W1XY');
  });
});
