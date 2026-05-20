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

describe('searchProductImage', () => {
  it('returns the first acceptable image URL', async () => {
    const fetchFn = makeFetch({
      items: [
        {
          link: 'https://m.media-amazon.com/images/I/abc.jpg',
          image: {
            contextLink: 'https://amazon.com/x',
            width: 1500,
            height: 1500,
          },
        },
      ],
    });
    const result = await searchProductImage('Patagonia', 'Nano Puff', {
      apiKey: 'k',
      cseId: 'c',
      fetchFn,
    });
    expect(result?.url).toBe('https://m.media-amazon.com/images/I/abc.jpg');
    expect(result?.pageUrl).toBe('https://amazon.com/x');
    expect(result?.width).toBe(1500);
  });

  it('skips blocked-host results and returns the next acceptable one', async () => {
    const fetchFn = makeFetch({
      items: [
        { link: 'https://i.pinimg.com/originals/p.jpg', image: { contextLink: 'https://pinterest.com/x' } },
        { link: 'https://i.ebayimg.com/images/g/abc/foo.jpg', image: { contextLink: 'https://ebay.com/x' } },
        { link: 'https://www.rei.com/media/product/185632', image: { contextLink: 'https://rei.com/x' } },
      ],
    });
    const result = await searchProductImage('REI Co-op', 'Half Dome', {
      apiKey: 'k',
      cseId: 'c',
      fetchFn,
    });
    expect(result?.url).toBe('https://www.rei.com/media/product/185632');
  });

  it('returns null when all results are blocked or non-image', async () => {
    const fetchFn = makeFetch({
      items: [
        { link: 'https://i.pinimg.com/x.jpg', image: {} },
        { link: 'https://example.com/page.html', image: {} },
      ],
    });
    const result = await searchProductImage('X', 'Y', { apiKey: 'k', cseId: 'c', fetchFn });
    expect(result).toBeNull();
  });

  it('returns null on no items', async () => {
    const fetchFn = makeFetch({ items: [] });
    const result = await searchProductImage('X', 'Y', { apiKey: 'k', cseId: 'c', fetchFn });
    expect(result).toBeNull();
  });

  it('returns null on quota error (403/429)', async () => {
    const fetchFn = makeFetch(
      { error: { message: 'Quota exceeded', code: 429 } },
      429,
    );
    const result = await searchProductImage('X', 'Y', { apiKey: 'k', cseId: 'c', fetchFn });
    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const result = await searchProductImage('X', 'Y', { apiKey: 'k', cseId: 'c', fetchFn });
    expect(result).toBeNull();
  });

  it('accepts Amazon /images/I/ dynamic paths even without an extension', async () => {
    const fetchFn = makeFetch({
      items: [{ link: 'https://m.media-amazon.com/images/I/AbCd', image: {} }],
    });
    const result = await searchProductImage('X', 'Y', { apiKey: 'k', cseId: 'c', fetchFn });
    expect(result?.url).toBe('https://m.media-amazon.com/images/I/AbCd');
  });
});
