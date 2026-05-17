import type { Facility, RecGovError } from './types.js';

const BASE_URL = 'https://ridb.recreation.gov/api/v1';
// The recreation.gov internal API powers the user-facing site (booking
// timeline, rates, releases). It's unauthenticated for the read endpoints
// we use, but we still pace requests to be a good citizen.
const PUBLIC_BASE_URL = 'https://www.recreation.gov/api/camps';

export interface RecGovClientOpts {
  apiKey: string;
  retryDelayMs?: number;
  maxRetries?: number;
  minIntervalMs?: number;
}

export interface FacilitySearchOpts {
  state?: string;
  limit?: number;
  offset?: number;
}

export interface RecAreaSearchOpts {
  recAreaId: number;
  limit?: number;
  offset?: number;
}

export interface ReleasesResponse {
  current_release: ReleaseBlock | null;
  next_release: ReleaseBlock | null;
}
export interface ReleaseBlock {
  release_time: string;   // ISO timestamp with timezone offset, e.g. "2026-05-16T17:00:00-04:00"
  end: string;             // ISO timestamp
  sliding_end?: string;
}

export interface RatesResponse {
  rates_list: RateSeason[];
}
export interface RateSeason {
  season_start: string;    // ISO timestamp (date portion only is significant)
  season_end: string;
  season_type: string;     // "Walk In", "Peak", "Off-Peak", etc.
  season_description?: string;
  // Per-site-type nightly price, keyed by "<SeasonType><CampsiteType>"
  // (e.g. "PeakSTANDARD NONELECTRIC": 25). Values are dollars.
  price_map?: Record<string, number>;
}

export interface RecGovClient {
  searchFacilities(opts: FacilitySearchOpts): Promise<Partial<Facility>[]>;
  searchFacilitiesByRecArea(opts: RecAreaSearchOpts): Promise<Partial<Facility>[]>;
  getFacility(facilityId: string): Promise<Partial<Facility>>;
  getFacilityCampsites(facilityId: string): Promise<Array<{ campsiteId: string; campsiteType: string }>>;
  getCampgroundReleases(facilityId: string): Promise<ReleasesResponse>;
  getCampgroundRates(facilityId: string): Promise<RatesResponse>;
}

function makeError(code: RecGovError['code'], message: string, status?: number): RecGovError {
  const e = new Error(message) as RecGovError;
  e.code = code;
  if (status !== undefined) e.status = status;
  return e;
}

export function createRecGovClient(opts: RecGovClientOpts): RecGovClient {
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 3;
  const minIntervalMs = opts.minIntervalMs ?? 200;
  let lastCallAt = 0;

  async function pace(): Promise<void> {
    const now = Date.now();
    const wait = lastCallAt + minIntervalMs - now;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  }

  async function call<T>(path: string, query: Record<string, string | number>): Promise<T> {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    return runRequest<T>(url, { apikey: opts.apiKey, Accept: 'application/json' }, path);
  }

  async function callPublic<T>(path: string): Promise<T> {
    const url = new URL(`${PUBLIC_BASE_URL}${path}`);
    return runRequest<T>(url, { Accept: 'application/json', 'User-Agent': 'outdoor-inventory/1.0' }, path);
  }

  async function runRequest<T>(url: URL, headers: Record<string, string>, path: string): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await pace();
      const resp = await fetch(url.toString(), { headers });
      if (resp.status === 429) {
        if (attempt === maxRetries) throw makeError('rate_limited', `Rec.gov 429 after ${maxRetries} retries`, 429);
        await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, attempt)));
        continue;
      }
      if (resp.status === 404) throw makeError('not_found', `Rec.gov 404 for ${path}`, 404);
      if (!resp.ok) throw makeError('api_error', `Rec.gov ${resp.status} for ${path}`, resp.status);
      return await resp.json() as T;
    }
    throw makeError('api_error', 'unreachable');
  }

  function mapSearchRow(r: Record<string, unknown>): Partial<Facility> {
    const recareas = Array.isArray(r.RECAREA) ? r.RECAREA as Array<Record<string, unknown>> : [];
    const addresses = Array.isArray(r.FACILITYADDRESS) ? r.FACILITYADDRESS as Array<Record<string, unknown>> : [];
    return {
      facilityId: String(r.FacilityID ?? ''),
      name: String(r.FacilityName ?? ''),
      parentUnit: String(recareas[0]?.RecAreaName ?? ''),
      lat: Number(r.FacilityLatitude ?? 0),
      lng: Number(r.FacilityLongitude ?? 0),
      state: String(addresses[0]?.AddressStateCode ?? ''),
      useType: r.FacilityTypeDescription === 'Picnic Area' ? 'day-use' : 'overnight',
    };
  }

  return {
    async searchFacilities(searchOpts) {
      const data = await call<{ RECDATA?: unknown }>(`/facilities`, {
        state: searchOpts.state ?? 'CO',
        limit: searchOpts.limit ?? 50,
        offset: searchOpts.offset ?? 0,
        full: 'true',
      });
      if (!Array.isArray(data.RECDATA)) throw makeError('schema_error', 'RECDATA missing from /facilities response');
      return (data.RECDATA as Array<Record<string, unknown>>).map(mapSearchRow);
    },
    async searchFacilitiesByRecArea(searchOpts) {
      const data = await call<{ RECDATA?: unknown }>(`/recareas/${searchOpts.recAreaId}/facilities`, {
        limit: searchOpts.limit ?? 50,
        offset: searchOpts.offset ?? 0,
        full: 'true',
      });
      if (!Array.isArray(data.RECDATA)) throw makeError('schema_error', `RECDATA missing from /recareas/${searchOpts.recAreaId}/facilities response`);
      // Facilities returned by this endpoint don't include a RECAREA child
      // (they're already scoped to the parent), so mapSearchRow's parent-unit
      // lookup gets nothing. We re-parent here by RecAreaName lookup keyed on
      // the rec area ID — done in the caller (index-refresh) where we have
      // the rec area name available, not here.
      return (data.RECDATA as Array<Record<string, unknown>>).map(mapSearchRow);
    },
    async getFacility(facilityId) {
      const data = await call<Record<string, unknown>>(`/facilities/${facilityId}`, { full: 'true' });
      if (typeof data !== 'object' || data === null) {
        throw makeError('schema_error', `unexpected non-object response from /facilities/${facilityId}`);
      }
      return mapSearchRow(data);
    },
    async getFacilityCampsites(facilityId) {
      const data = await call<{ RECDATA?: unknown }>(`/facilities/${facilityId}/campsites`, {});
      if (!Array.isArray(data.RECDATA)) return [];
      return (data.RECDATA as Array<Record<string, unknown>>).map((r) => ({
        campsiteId: String(r.CampsiteID ?? ''),
        campsiteType: String(r.CampsiteType ?? ''),
      }));
    },
    async getCampgroundReleases(facilityId) {
      return callPublic<ReleasesResponse>(`/campgrounds/${facilityId}/releases`);
    },
    async getCampgroundRates(facilityId) {
      return callPublic<RatesResponse>(`/campgrounds/${facilityId}/rates`);
    },
  };
}
