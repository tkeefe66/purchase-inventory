import { describe, it, expect, vi } from 'vitest';
import { isBlockedHost, lookupProductImageUrl } from '../../lib/integrations/image-lookup.js';

describe('lookupProductImageUrl', () => {
  it('returns the URL from the model JSON output', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '{"imageUrl": "https://images.rei.com/skuimage/123.jpg"}',
            },
          ],
        }),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'Patagonia',
      itemName: 'Nano Puff Jacket',
      productUrl: 'https://patagonia.com/x',
    });
    expect(url).toBe('https://images.rei.com/skuimage/123.jpg');
  });

  it('returns null on empty / no-match JSON', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"imageUrl": ""}' }],
        }),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'Mystery',
      itemName: 'Unicorn Slippers',
      productUrl: '',
    });
    expect(url).toBeNull();
  });

  it('returns null when the model throws', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('429')),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'X',
      itemName: 'Y',
      productUrl: '',
    });
    expect(url).toBeNull();
  });

  it('drops a result hosted on a blocked aggregator host', async () => {
    const fakeAnthropic = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: '{"imageUrl": "https://i.pinimg.com/originals/abc.jpg"}',
            },
          ],
        }),
      },
    } as unknown as Parameters<typeof lookupProductImageUrl>[0];

    const url = await lookupProductImageUrl(fakeAnthropic, {
      brand: 'Patagonia',
      itemName: 'Black Hole 25L',
      productUrl: '',
    });
    expect(url).toBeNull();
  });
});

describe('isBlockedHost', () => {
  it('matches the registered domain', () => {
    expect(isBlockedHost('https://pinterest.com/x.jpg')).toBe(true);
    expect(isBlockedHost('https://www.ebay.com/a.png')).toBe(true);
  });

  it('matches subdomains of blocked registered domains', () => {
    expect(isBlockedHost('https://i.pinimg.com/originals/abc.jpg')).toBe(true);
    expect(isBlockedHost('https://i.redd.it/foo.png')).toBe(true);
  });

  it('passes legitimate retailer CDNs', () => {
    expect(isBlockedHost('https://m.media-amazon.com/images/I/abc.jpg')).toBe(false);
    expect(isBlockedHost('https://www.rei.com/media/product/123')).toBe(false);
    expect(isBlockedHost('https://images.evo.com/skis/xyz.jpg')).toBe(false);
  });

  it('returns false for garbage / non-URL input', () => {
    expect(isBlockedHost('not-a-url')).toBe(false);
  });
});
