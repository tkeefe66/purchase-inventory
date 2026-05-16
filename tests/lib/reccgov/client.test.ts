import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecGovClient } from '../../../lib/reccgov/client.js';

const SEARCH_RESPONSE = {
  RECDATA: [
    {
      FacilityID: '231959',
      FacilityName: 'Maroon Bells Amphitheater',
      FacilityLatitude: 39.097,
      FacilityLongitude: -106.948,
      FacilityTypeDescription: 'Campground',
      RECAREA: [{ RecAreaID: '1234', RecAreaName: 'White River National Forest' }],
      FACILITYADDRESS: [{ AddressStateCode: 'CO', AddressCountryCode: 'USA' }],
    },
  ],
};

describe('RecGovClient.searchFacilities', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('returns parsed facilities from a happy-path response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SEARCH_RESPONSE), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.searchFacilities({ state: 'CO' });
    expect(out).toHaveLength(1);
    expect(out[0]!.facilityId).toBe('231959');
    expect(out[0]!.name).toBe('Maroon Bells Amphitheater');
    expect(out[0]!.parentUnit).toBe('White River National Forest');
    expect(out[0]!.state).toBe('CO');
    const calledUrl = (spy.mock.calls[0]![0] as string);
    expect(calledUrl).toMatch(/full=true/);
  });

  test('returns empty parentUnit + state when RECAREA / FACILITYADDRESS are absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        RECDATA: [{
          FacilityID: '1', FacilityName: 'Bare', FacilityLatitude: 0, FacilityLongitude: 0,
          FacilityTypeDescription: 'Facility',
        }],
      }), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.searchFacilities({ state: 'CO' });
    expect(out[0]!.parentUnit).toBe('');
    expect(out[0]!.state).toBe('');
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

describe('RecGovClient.getFacility', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test('parses an un-wrapped single-resource response (RIDB returns the facility directly)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        FacilityID: '252205',
        FacilityName: 'Lynx Pass Campground',
        FacilityLatitude: 40.0, FacilityLongitude: -106.7,
        FacilityTypeDescription: 'Campground',
        RECAREA: [{ RecAreaID: '99', RecAreaName: 'Routt National Forest' }],
        FACILITYADDRESS: [{ AddressStateCode: 'CO' }],
      }), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.getFacility('252205');
    expect(out.facilityId).toBe('252205');
    expect(out.name).toBe('Lynx Pass Campground');
    expect(out.parentUnit).toBe('Routt National Forest');
    expect(out.state).toBe('CO');
  });
});

describe('RecGovClient.getCampgroundReleases', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('hits the recreation.gov public API and returns the parsed response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        current_release: {
          release_time: '2026-05-16T17:00:00-04:00',
          end: '2026-10-11T00:00:00Z',
          sliding_end: '2026-10-11T00:00:00Z',
        },
        next_release: {
          release_time: '2026-12-04T10:00:00-05:00',
          end: '2027-06-04T00:00:00Z',
        },
      }), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.getCampgroundReleases('231866');
    expect(out.current_release?.release_time).toBe('2026-05-16T17:00:00-04:00');
    expect(out.next_release?.release_time).toBe('2026-12-04T10:00:00-05:00');
    expect((spy.mock.calls[0]![0] as string)).toContain('recreation.gov/api/camps/campgrounds/231866/releases');
  });
});

describe('RecGovClient.getCampgroundRates', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('returns the parsed rates_list', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        rates_list: [
          { season_start: '2026-05-15T00:00:00Z', season_end: '2026-05-21T00:00:00Z', season_type: 'Walk In', season_description: 'First-come, First-served Season' },
          { season_start: '2026-05-22T00:00:00Z', season_end: '2026-09-21T00:00:00Z', season_type: 'Peak', season_description: 'Peak Season' },
        ],
      }), { status: 200 }),
    );
    const client = createRecGovClient({ apiKey: 'TEST' });
    const out = await client.getCampgroundRates('231866');
    expect(out.rates_list).toHaveLength(2);
    expect(out.rates_list[0]!.season_type).toBe('Walk In');
    expect((spy.mock.calls[0]![0] as string)).toContain('recreation.gov/api/camps/campgrounds/231866/rates');
  });
});
