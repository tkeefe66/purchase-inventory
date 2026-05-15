import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProductName } from '../../lib/parsers/product-lookup.js';

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
});
