import { describe, it, expect, vi } from 'vitest';
import { searchProductImage } from '../../lib/integrations/image-search.js';

function makeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('searchProductImage (Brave)', () => {
  it('returns the first acceptable result from properties.url', async () => {
    const fetchFn = makeFetch({
      results: [
        {
          url: 'https://patagonia.com/product/nano-puff',
          source: 'https://patagonia.com/product/nano-puff',
          properties: { url: 'https://www.patagonia.com/dw/image/v2/abc.jpg' },
          thumbnail: { src: 'https://imgs.search.brave.com/proxy.jpg' },
        },
      ],
    });
    const result = await searchProductImage('Patagonia', 'Nano Puff', {
      provider: 'brave',
      apiKey: 'tok',
      fetchFn,
    });
    expect(result?.url).toBe('https://www.patagonia.com/dw/image/v2/abc.jpg');
    expect(result?.pageUrl).toBe('https://patagonia.com/product/nano-puff');
  });

  it('falls back to thumbnail.original when properties.url is missing', async () => {
    const fetchFn = makeFetch({
      results: [
        {
          url: 'https://example.com/page',
          thumbnail: { original: 'https://example.com/canonical.jpg' },
        },
      ],
    });
    const result = await searchProductImage('X', 'Y', {
      provider: 'brave',
      apiKey: 'tok',
      fetchFn,
    });
    expect(result?.url).toBe('https://example.com/canonical.jpg');
  });

  it('skips blocked-host results and returns the next acceptable one', async () => {
    const fetchFn = makeFetch({
      results: [
        { properties: { url: 'https://i.pinimg.com/originals/p.jpg' } },
        { properties: { url: 'https://i.ebayimg.com/images/g/abc/foo.jpg' } },
        {
          url: 'https://rei.com/x',
          properties: { url: 'https://www.rei.com/media/product/185632' },
        },
      ],
    });
    const result = await searchProductImage('REI Co-op', 'Half Dome', {
      provider: 'brave',
      apiKey: 'tok',
      fetchFn,
    });
    expect(result?.url).toBe('https://www.rei.com/media/product/185632');
  });

  it('returns null when all results are blocked or non-image', async () => {
    const fetchFn = makeFetch({
      results: [
        { properties: { url: 'https://i.pinimg.com/x.jpg' } },
        { properties: { url: 'https://example.com/page.html' } },
      ],
    });
    const result = await searchProductImage('X', 'Y', { provider: 'brave', apiKey: 'tok', fetchFn });
    expect(result).toBeNull();
  });

  it('returns null on empty results', async () => {
    const fetchFn = makeFetch({ results: [] });
    const result = await searchProductImage('X', 'Y', { provider: 'brave', apiKey: 'tok', fetchFn });
    expect(result).toBeNull();
  });

  it('returns null on quota error (403/429)', async () => {
    const fetchFn = makeFetch({ error: 'quota' }, 429);
    const result = await searchProductImage('X', 'Y', { provider: 'brave', apiKey: 'tok', fetchFn });
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const result = await searchProductImage('X', 'Y', { provider: 'brave', apiKey: 'tok', fetchFn });
    expect(result).toBeNull();
  });

  it('accepts Amazon /images/I/ dynamic paths even without an extension', async () => {
    const fetchFn = makeFetch({
      results: [{ properties: { url: 'https://m.media-amazon.com/images/I/AbCd' } }],
    });
    const result = await searchProductImage('X', 'Y', { provider: 'brave', apiKey: 'tok', fetchFn });
    expect(result?.url).toBe('https://m.media-amazon.com/images/I/AbCd');
  });

  it('sends the X-Subscription-Token header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    await searchProductImage('Patagonia', 'Nano Puff', {
      provider: 'brave',
      apiKey: 'tok-xyz',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const call = fetchFn.mock.calls[0]!;
    expect(call[0]).toContain('api.search.brave.com');
    expect((call[1] as { headers: Record<string, string> }).headers['X-Subscription-Token']).toBe('tok-xyz');
  });
});

describe('searchProductImage (Google CSE legacy fallback)', () => {
  it('still works against Google CSE response shape', async () => {
    const fetchFn = makeFetch({
      items: [
        {
          link: 'https://m.media-amazon.com/images/I/abc.jpg',
          image: { contextLink: 'https://amazon.com/x', width: 1500, height: 1500 },
        },
      ],
    });
    const result = await searchProductImage('Patagonia', 'Nano Puff', {
      provider: 'google-cse',
      apiKey: 'k',
      cseId: 'c',
      fetchFn,
    });
    expect(result?.url).toBe('https://m.media-amazon.com/images/I/abc.jpg');
    expect(result?.pageUrl).toBe('https://amazon.com/x');
    expect(result?.width).toBe(1500);
  });
});
