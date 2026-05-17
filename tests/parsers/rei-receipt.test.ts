import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseReiEmail, parseReiReceiptEmail } from '../../lib/parsers/rei.js';
import { extractProductId } from '../../lib/productId.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/rei');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

const RECEIPT_6_ITEM = '19e325cc958f2176__Your_REI_eReceipt_-_store_purchase.html';
const RECEIPT_5_ITEM = '19794104d7ec46a5__Your_REI_eReceipt_-_store_purchase.html';
const RECEIPT_15_ITEM = '19336f1615ef6184__Your_REI_eReceipt_-_store_purchase.html';
const ONLINE_ORDER = '19dd9b2a7d11aca2__Thanks_for_your_order!_(A398129839).html';
const DELIVERY_NOTICE = '19de52cf28d8e9bf__Your_order_was_delivered!.html';

describe('parseReiReceiptEmail', () => {
  test('builds orderId from Store + Transaction numbers', () => {
    const result = parseReiReceiptEmail(loadFixture(RECEIPT_6_ITEM));
    expect(result).not.toBeNull();
    expect(result?.orderId).toBe('S18-T6158');
    expect(result?.source).toBe('REI');
  });

  test('builds different orderId for a different transaction', () => {
    const result = parseReiReceiptEmail(loadFixture(RECEIPT_5_ITEM));
    expect(result?.orderId).toBe('S18-T1496');
  });

  test('extracts each line item with name, qty, price, synthesized product URL', () => {
    const result = parseReiReceiptEmail(loadFixture(RECEIPT_6_ITEM));
    expect(result?.items).toHaveLength(6);

    const first = result!.items[0]!;
    expect(first.itemName).toBe('Trlmade Rain Pant');
    expect(first.price).toBe(52.39);
    expect(first.quantity).toBe(1);
    expect(first.productUrl).toBe('https://www.rei.com/product/235245');
  });

  test('synthesized productUrl parses back into the rei:<id> productId', () => {
    const result = parseReiReceiptEmail(loadFixture(RECEIPT_6_ITEM));
    const first = result!.items[0]!;
    expect(extractProductId(first.productUrl)).toBe('rei:235245');
  });

  test('aggregates same-product line items (4 Clif bars → 1 row qty=4)', () => {
    const result = parseReiReceiptEmail(loadFixture(RECEIPT_15_ITEM));
    expect(result).not.toBeNull();
    const clifBars = result!.items.filter((i) => i.productUrl.endsWith('/604787'));
    expect(clifBars).toHaveLength(1);
    expect(clifBars[0]!.quantity).toBe(4);

    const stingers = result!.items.filter((i) => i.productUrl.endsWith('/189962'));
    expect(stingers).toHaveLength(1);
    expect(stingers[0]!.quantity).toBe(3);
  });

  test('leaves color and size blank (eReceipts do not expose them)', () => {
    const result = parseReiReceiptEmail(loadFixture(RECEIPT_6_ITEM));
    const first = result!.items[0]!;
    expect(first.color ?? '').toBe('');
    expect(first.size ?? '').toBe('');
  });

  test('returns null for an online order email (different format)', () => {
    expect(parseReiReceiptEmail(loadFixture(ONLINE_ORDER))).toBeNull();
  });

  test('returns null for a delivery notification', () => {
    expect(parseReiReceiptEmail(loadFixture(DELIVERY_NOTICE))).toBeNull();
  });
});

describe('parseReiEmail (online) and parseReiReceiptEmail (in-store) are mutually exclusive', () => {
  test('online parser returns null on an eReceipt', () => {
    expect(parseReiEmail(loadFixture(RECEIPT_6_ITEM))).toBeNull();
  });

  test('receipt parser returns null on an online order email', () => {
    expect(parseReiReceiptEmail(loadFixture(ONLINE_ORDER))).toBeNull();
  });
});
