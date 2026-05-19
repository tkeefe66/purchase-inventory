import { describe, it, expect, vi } from 'vitest';
import { lookupProductImageUrl } from '../../lib/integrations/image-lookup.js';

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
});
