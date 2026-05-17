import { describe, test, expect, vi, beforeEach } from 'vitest';
import { enrichReiReceiptItems } from '../../lib/parsers/rei-receipt-enrich.js';
import * as lookupModule from '../../lib/parsers/rei-product-lookup.js';
import type { ParsedItem } from '../../lib/parsers/types.js';

function rawItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    itemName: 'Charger MIPS',
    quantity: 1,
    price: 199.99,
    productUrl: 'https://www.rei.com/product/235245',
    color: '',
    size: '',
    ...overrides,
  };
}

describe('enrichReiReceiptItems', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('replaces the POS abbreviation with the canonical name + brand', async () => {
    vi.spyOn(lookupModule, 'lookupReceiptItem').mockResolvedValue({
      brand: 'Smith',
      itemName: 'Charger MIPS Snow Helmet',
      color: '',
      size: '',
    });
    const out = await enrichReiReceiptItems([rawItem()], {} as never);
    expect(out[0]).toMatchObject({
      itemName: 'Charger MIPS Snow Helmet',
      brand: 'Smith',
      productUrl: 'https://www.rei.com/product/235245',
      quantity: 1,
      price: 199.99,
    });
  });

  test('falls back to the raw item when lookup returns null', async () => {
    vi.spyOn(lookupModule, 'lookupReceiptItem').mockResolvedValue(null);
    const item = rawItem();
    const out = await enrichReiReceiptItems([item], {} as never);
    expect(out[0]).toEqual(item);
  });

  test('falls back to the raw item when lookup throws', async () => {
    vi.spyOn(lookupModule, 'lookupReceiptItem').mockRejectedValue(new Error('boom'));
    const item = rawItem();
    const out = await enrichReiReceiptItems([item], {} as never);
    expect(out[0]).toEqual(item);
  });

  test('preserves raw item when lookup returns empty fields', async () => {
    vi.spyOn(lookupModule, 'lookupReceiptItem').mockResolvedValue({
      brand: '',
      itemName: '',
      color: '',
      size: '',
    });
    const item = rawItem();
    const out = await enrichReiReceiptItems([item], {} as never);
    expect(out[0]).toEqual(item);
  });

  test('preserves quantity, price, productUrl after enrichment', async () => {
    vi.spyOn(lookupModule, 'lookupReceiptItem').mockResolvedValue({
      brand: 'Smith',
      itemName: 'Charger MIPS Snow Helmet',
      color: '',
      size: '',
    });
    const item = rawItem({ quantity: 2, price: 100 });
    const out = await enrichReiReceiptItems([item], {} as never);
    expect(out[0]).toMatchObject({
      quantity: 2,
      price: 100,
      productUrl: item.productUrl,
    });
  });

  test('writes color and size when lookup returned them', async () => {
    vi.spyOn(lookupModule, 'lookupReceiptItem').mockResolvedValue({
      brand: 'Patagonia',
      itemName: 'Nano Puff Jacket',
      color: 'Black',
      size: 'M',
    });
    const out = await enrichReiReceiptItems([rawItem({ itemName: 'Nano Puff Jacket' })], {} as never);
    expect(out[0]).toMatchObject({
      itemName: 'Nano Puff Jacket',
      brand: 'Patagonia',
      color: 'Black',
      size: 'M',
    });
  });
});
