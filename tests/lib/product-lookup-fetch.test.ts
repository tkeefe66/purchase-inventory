import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProductName, lookupProduct } from '../../lib/parsers/product-lookup.js';
import type Anthropic from '@anthropic-ai/sdk';

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

describe('fetchProductName', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('extracts canonical name from og:title and strips brand prefix', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head>
        <meta property="og:title" content="L.L.Bean Bean Boots, 8&quot; Insulated, Men's">
        <title>L.L.Bean - Outdoor Gear</title>
      </head></html>
    `));
    const result = await fetchProductName('https://llbean.com/x', 'L.L.Bean');
    expect(result).toBe(`Bean Boots, 8" Insulated, Men's`);
  });

  test('falls back to <title> when og:title is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head>
        <title>Patagonia Houdini Jacket | REI Co-op</title>
      </head></html>
    `));
    const result = await fetchProductName('https://rei.com/x', 'Patagonia');
    expect(result).toBe('Houdini Jacket');
  });

  test('strips em-dash and en-dash trailing site name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head><title>Bean Boots – L.L.Bean</title></head></html>
    `));
    const result = await fetchProductName('https://llbean.com/x', 'L.L.Bean');
    expect(result).toBe('Bean Boots');
  });

  test('returns null on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const result = await fetchProductName('https://example.com/missing', 'X');
    expect(result).toBeNull();
  });

  test('returns null on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
    const result = await fetchProductName('https://example.com/x', 'X');
    expect(result).toBeNull();
  });

  test('returns null when neither og:title nor <title> is present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`<html><body>nothing</body></html>`));
    const result = await fetchProductName('https://example.com/x', 'X');
    expect(result).toBeNull();
  });

  test('returns null for non-http URLs', async () => {
    const result = await fetchProductName('ftp://example.com/x', 'X');
    expect(result).toBeNull();
  });

  test('handles brand prefix with periods (L.L.Bean vs LL Bean)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head><title>L.L. Bean Bean Boots</title></head></html>
    `));
    const result = await fetchProductName('https://llbean.com/x', 'LL Bean');
    expect(result).toBe('Bean Boots');
  });

  test('skips Amazon URLs entirely (bot-shield serves junk titles)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchProductName(
      'https://www.amazon.com/Forbidden-Road-380T-Nylon-Portable/dp/B072WQ8BJW',
      'Forbidden Road',
    );
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects a title that is just the source hostname (Amazon.com)', async () => {
    // Belt-and-suspenders: even on hosts we don't preemptively skip, if the
    // extracted title equals the domain, treat it as junk.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head><meta property="og:title" content="Example.com"></head></html>
    `));
    const result = await fetchProductName('https://example.com/x', 'Forbidden Road');
    expect(result).toBeNull();
  });

  test('rejects "Robot Check" / bot-shield titles', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head><title>Robot Check</title></head></html>
    `));
    const result = await fetchProductName('https://example.com/x', 'Forbidden Road');
    expect(result).toBeNull();
  });

  test('rejects a title that is just the brand', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
      <html><head><title>Patagonia</title></head></html>
    `));
    const result = await fetchProductName('https://patagonia.com/x', 'Patagonia');
    expect(result).toBeNull();
  });

  test('rejects "Sign In" / "Just a moment" / "404" pages', async () => {
    for (const title of ['Sign In', 'Just a moment...', '404 Not Found', 'Page Not Found']) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(`
        <html><head><title>${title}</title></head></html>
      `));
      const result = await fetchProductName('https://example.com/x', 'Forbidden Road');
      expect(result, `should reject "${title}"`).toBeNull();
    }
  });
});

describe('lookupProduct — domain-fallback on blocked-by-Anthropic 400', () => {
  test('drops the blocked domain and retries successfully', async () => {
    const create = vi.fn();
    // First call: 400 because one of our currently-allowed domains is blocked.
    // (Picking rei.com — definitely in PRODUCT_LOOKUP_DOMAINS — so the filter
    // actually drops something and the retry has a different domain list.)
    create.mockRejectedValueOnce(
      new Error(`400 {"type":"error","error":{"type":"invalid_request_error","message":"The following domains are not accessible to our user agent: ['rei.com']."}}`),
    );
    create.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          candidates: [{
            itemName: 'Bean Boots',
            productUrl: 'https://www.llbean.com/p/123',
            source: 'llbean.com',
          }],
        }),
      }],
    });
    const fakeAnthropic = { messages: { create } } as unknown as Anthropic;
    const out = await lookupProduct(fakeAnthropic, 'L.L.Bean', 'Bean Boots 8"');
    expect(out).toHaveLength(1);
    expect(out[0]!.itemName).toBe('Bean Boots');
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('returns [] when the error is not a blocked-domain message', async () => {
    const create = vi.fn().mockRejectedValue(new Error('500 internal server error'));
    const fakeAnthropic = { messages: { create } } as unknown as Anthropic;
    const out = await lookupProduct(fakeAnthropic, 'X', 'Y');
    expect(out).toEqual([]);
  });
});
