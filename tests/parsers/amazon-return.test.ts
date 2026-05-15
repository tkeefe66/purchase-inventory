import { describe, test, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { parseAmazonReturnEmail } from '../../lib/parsers/amazon-return.js';

function loadFixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, '../fixtures', name), 'utf-8');
}

function fakeAnthropic(jsonResponse: object): Anthropic {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(jsonResponse) }],
  });
  return { messages: { create } } as unknown as Anthropic;
}

describe('parseAmazonReturnEmail', () => {
  test('parses a "Refund issued" email', async () => {
    const html = loadFixture('amazon-return-refund-sigma.html');
    const fakeAnt = fakeAnthropic({
      orderId: '113-5552273-5061006',
      items: [{
        itemName: 'SIGMA 18-50mm F2.8 DC DN Contemporary',
        productUrl: 'https://www.amazon.com/dp/B09ZZZZZZZ',
      }],
    });
    const result = await parseAmazonReturnEmail(fakeAnt, html);
    expect(result).not.toBeNull();
    expect(result!.orderId).toBe('113-5552273-5061006');
    expect(result!.items).toHaveLength(1);
    expect(result!.items[0]!.itemName).toMatch(/SIGMA/);
  });

  test('parses a "Dropoff confirmed" email', async () => {
    const html = loadFixture('amazon-return-dropoff-sigma.html');
    const fakeAnt = fakeAnthropic({
      orderId: '113-5552273-5061006',
      items: [{
        itemName: 'SIGMA 18-50mm F2.8 DC DN Contemporary',
        productUrl: '',
      }],
    });
    const result = await parseAmazonReturnEmail(fakeAnt, html);
    expect(result).not.toBeNull();
    expect(result!.items[0]!.itemName).toMatch(/SIGMA/);
  });

  test('falls back to regex-scraped Order ID when Haiku omits it', async () => {
    const html = loadFixture('amazon-return-refund-sigma.html');
    const fakeAnt = fakeAnthropic({
      orderId: '',
      items: [{ itemName: 'SIGMA 18-50mm', productUrl: '' }],
    });
    const result = await parseAmazonReturnEmail(fakeAnt, html);
    // Should pull a 113-/114- pattern out of the body text.
    expect(result).not.toBeNull();
    expect(result!.orderId).toMatch(/^\d{3}-\d{7}-\d{7}$/);
  });

  test('returns null when Haiku returns no items', async () => {
    const html = loadFixture('amazon-return-refund-sigma.html');
    const fakeAnt = fakeAnthropic({ orderId: '113-1234567-1234567', items: [] });
    expect(await parseAmazonReturnEmail(fakeAnt, html)).toBeNull();
  });

  test('returns null when no Order ID is recoverable', async () => {
    const html = '<html><body>You are awesome, here is a coupon</body></html>';
    const fakeAnt = fakeAnthropic({ orderId: '', items: [{ itemName: 'X', productUrl: '' }] });
    expect(await parseAmazonReturnEmail(fakeAnt, html)).toBeNull();
  });
});
