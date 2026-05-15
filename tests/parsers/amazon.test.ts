import { describe, test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { parseAmazonShipmentEmail, parseAmazonOrderEmail } from '../../lib/parsers/amazon.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/amazon');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('parseAmazonShipmentEmail', () => {
  test('extracts a single Order ID from a shipment-tracking email', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonShipmentEmail(html);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]!.orderId).toBe('114-4360051-0313822');
    expect(result![0]!.source).toBe('Amazon');
  });

  test('returns null for an order-confirmation email — order parser handles those separately', () => {
    const html = loadFixture(
      '1967d7a54e6a90c4__Ordered-_-Insta360_Bullet_Time_Bundle...-_and_1_more_item.html',
    );
    expect(parseAmazonShipmentEmail(html)).toBeNull();
  });

  test('extracts the line item from a single-item shipment (Sony camera)', () => {
    const html = loadFixture(
      '19ddb0594086a4ab__Shipped-_-Sony_Alpha_a6700_Mirrorless...-.html',
    );
    const result = parseAmazonShipmentEmail(html);
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
    const result = parseAmazonShipmentEmail(html);
    // Sony shipment has 1 real item + 3 ads (Anker x2, Coleman). Parser should return 1.
    expect(result![0]!.items).toHaveLength(1);
    const allItemNames = result![0]!.items.map((i) => i.itemName);
    expect(allItemNames.some((n) => n.includes('Anker'))).toBe(false);
    expect(allItemNames.some((n) => n.includes('Coleman'))).toBe(false);
  });
});

describe('parseAmazonOrderEmail', () => {
  function fakeAnthropic(jsonResponse: object): Anthropic {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(jsonResponse) }],
    });
    return { messages: { create } } as unknown as Anthropic;
  }

  test('parses a single-item "Ordered:" email via Haiku', async () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../fixtures/amazon-auto-confirm-eucalan.html'),
      'utf-8',
    );
    const fakeAnt = fakeAnthropic({
      orderId: '113-8780872-2847422',
      items: [{
        itemName: 'Eucalan No Rinse Delicate Wash, 16.9 Fl Oz, Lavender',
        quantity: 1,
        price: 19.41,
        productUrl: 'https://www.amazon.com/dp/B00MKAU3F4',
      }],
    });
    const result = await parseAmazonOrderEmail(fakeAnt, html);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]!.orderId).toBe('113-8780872-2847422');
    expect(result![0]!.source).toBe('Amazon');
    expect(result![0]!.items).toHaveLength(1);
    expect(result![0]!.items[0]!.price).toBe(19.41);
    expect(result![0]!.items[0]!.itemName).toMatch(/Eucalan/);
  });

  test('parses a multi-item "Ordered: … and N more items" email', async () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../fixtures/amazon-auto-confirm-peak-design.html'),
      'utf-8',
    );
    const fakeAnt = fakeAnthropic({
      orderId: '113-9999999-9999999',
      items: [
        { itemName: 'Peak Design Capture Camera Clip V3', quantity: 1, price: 79.95, productUrl: 'https://www.amazon.com/dp/X1' },
        { itemName: 'Think Tank Lens Pouch', quantity: 1, price: 39.95, productUrl: '' },
        { itemName: 'USA Gear Camera Sleeve', quantity: 1, price: 19.99, productUrl: '' },
        { itemName: 'Sigma 18-50mm F2.8 DC DN Lens', quantity: 1, price: 549, productUrl: '' },
      ],
    });
    const result = await parseAmazonOrderEmail(fakeAnt, html);
    expect(result).not.toBeNull();
    expect(result![0]!.items).toHaveLength(4);
  });

  test('returns null when Haiku returns no items', async () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../fixtures/amazon-auto-confirm-eucalan.html'),
      'utf-8',
    );
    const fakeAnt = fakeAnthropic({ orderId: '113-8780872-2847422', items: [] });
    expect(await parseAmazonOrderEmail(fakeAnt, html)).toBeNull();
  });

  test('returns null for an email that is not an order confirmation', async () => {
    const html = '<html><body>You got a 20% off coupon!</body></html>';
    const fakeAnt = fakeAnthropic({ orderId: '', items: [] });
    expect(await parseAmazonOrderEmail(fakeAnt, html)).toBeNull();
  });

  test('falls back to regex-scraped Order ID when Haiku omits it', async () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../fixtures/amazon-auto-confirm-eucalan.html'),
      'utf-8',
    );
    const fakeAnt = fakeAnthropic({
      orderId: '',  // Haiku didn't return one
      items: [{ itemName: 'Eucalan', quantity: 1, price: 19.41, productUrl: '' }],
    });
    const result = await parseAmazonOrderEmail(fakeAnt, html);
    expect(result![0]!.orderId).toMatch(/^\d{3}-\d{7}-\d{7}$/);
  });

  test('handles markdown-fenced JSON response from Haiku', async () => {
    const html = readFileSync(
      resolve(import.meta.dirname, '../fixtures/amazon-auto-confirm-eucalan.html'),
      'utf-8',
    );
    const fakeAnt = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '```json\n{"orderId":"113-8780872-2847422","items":[{"itemName":"X","quantity":1,"price":1.99,"productUrl":""}]}\n```' }],
        }),
      },
    } as unknown as Anthropic;
    const result = await parseAmazonOrderEmail(fakeAnt, html);
    expect(result).not.toBeNull();
    expect(result![0]!.items[0]!.itemName).toBe('X');
  });
});
