import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecGovClient } from '../../../lib/reccgov/client.js';

const SEARCH_RESPONSE = {
  RECDATA: [
    {
      FacilityID: '231959',
      FacilityName: 'Maroon Bells Amphitheater',
      ParentRECAREAName: 'White River National Forest',
      FacilityLatitude: 39.097,
      FacilityLongitude: -106.948,
      FacilityTypeDescription: 'Campground',
      AddressStateCode: 'CO',
    },
  ],
};

describe('RecGovClient.searchFacilities', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns parsed facilities from a happy-path response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.searchFacilities({ state: 'CO' });
    expect(out).toHaveLength(1);
    expect(out[0]!.facilityId).toBe('231959');
    expect(out[0]!.name).toBe('Maroon Bells Amphitheater');
    expect(out[0]!.parentUnit).toBe('White River National Forest');
  });

  test('retries on 429 with backoff', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }));
    const client = createRecGovClient({ apiKey: 'TEST', retryDelayMs: 1 });
    const out = await client.searchFacilities({ state: 'CO' });
    expect(out).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test('throws RecGovError after max retries on 429', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    const client = createRecGovClient({ apiKey: 'TEST', retryDelayMs: 1, maxRetries: 2 });
    await expect(client.searchFacilities({ state: 'CO' })).rejects.toMatchObject({ code: 'rate_limited' });
  });

  test('throws schema_error on malformed response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    await expect(client.searchFacilities({ state: 'CO' })).rejects.toMatchObject({ code: 'schema_error' });
  });
});
