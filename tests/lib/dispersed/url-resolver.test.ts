import { describe, test, expect, vi } from 'vitest';
import { resolveAgencyUrl } from '../../../lib/dispersed/url-resolver.js';

function mockAnthropic(textOut: string): { messages: { create: ReturnType<typeof vi.fn> } } {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: textOut }],
      }),
    },
  };
}

describe('resolveAgencyUrl', () => {
  test('returns the URL when Haiku replies with a clean agency URL', async () => {
    const a = mockAnthropic('https://www.fs.usda.gov/r03/carson/recreation/trout-lakes-campground');
    const url = await resolveAgencyUrl(a as never, {
      name: 'Trout Lakes Campground',
      agency: 'Carson National Forest',
      domain: 'fs.usda.gov',
    });
    expect(url).toBe('https://www.fs.usda.gov/r03/carson/recreation/trout-lakes-campground');
  });

  test('extracts URL from text with surrounding whitespace / punctuation', async () => {
    const a = mockAnthropic('  https://www.blm.gov/visit/lower-dolores  ');
    const url = await resolveAgencyUrl(a as never, {
      name: 'Lower Dolores', agency: 'BLM Tres Rios FO', domain: 'blm.gov',
    });
    expect(url).toBe('https://www.blm.gov/visit/lower-dolores');
  });

  test('returns null on "NONE" sentinel', async () => {
    const a = mockAnthropic('NONE');
    const url = await resolveAgencyUrl(a as never, {
      name: 'Nonexistent', agency: 'Bogus Forest', domain: 'fs.usda.gov',
    });
    expect(url).toBeNull();
  });

  test('returns null when Haiku returns a URL off-domain (anti-hallucination guard)', async () => {
    const a = mockAnthropic('https://allcamping.com/trout-lakes');
    const url = await resolveAgencyUrl(a as never, {
      name: 'Trout Lakes Campground', agency: 'Carson National Forest', domain: 'fs.usda.gov',
    });
    expect(url).toBeNull();
  });

  test('returns null when no URL is present in the reply', async () => {
    const a = mockAnthropic('I could not find the page.');
    const url = await resolveAgencyUrl(a as never, {
      name: 'X', agency: 'Y', domain: 'fs.usda.gov',
    });
    expect(url).toBeNull();
  });

  test('returns null when Anthropic call throws', async () => {
    const a = {
      messages: { create: vi.fn().mockRejectedValue(new Error('boom')) },
    };
    const url = await resolveAgencyUrl(a as never, {
      name: 'X', agency: 'Y', domain: 'fs.usda.gov',
    });
    expect(url).toBeNull();
  });
});
