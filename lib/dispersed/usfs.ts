import { WESTERN_US_BBOX } from './types.js';
import type { DispersedSpot } from './types.js';
import { buildAgencySearchUrl } from './search-url.js';
import { stripHtml } from './text.js';

/**
 * US Forest Service "Recreation Area Activities" ArcGIS feature layer.
 *
 * One row per (rec area × activity) — we filter to markeractivity='Dispersed
 * Camping' to get the ~1,150 USFS-sanctioned dispersed-camping locations
 * nationwide (~600–800 in the Western US after bbox filter).
 *
 * Data is US public domain — no auth, no rate limit beyond ArcGIS courtesy.
 */
const USFS_QUERY_URL =
  'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationAreaActivities_01/MapServer/0/query';

const PAGE_SIZE = 2000;

export interface UsfsArcgisAttributes {
  recareaid?: number | string;
  recareaname?: string;
  recareaurl?: string;
  forestname?: string;
  forestid?: number | string;
  recareadescription?: string;
  markeractivity?: string;
  open_season_start?: string;
  open_season_end?: string;
  openstatus?: string;
  // The USFS feature layer returns lat/lng as STRINGS (e.g. "-106.373800")
  // even though they're documented as numeric. Discovered 2026-05-17.
  longitude?: number | string;
  latitude?: number | string;
}

function toCoord(v: number | string | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

interface ArcgisFeature {
  attributes: UsfsArcgisAttributes;
  geometry?: { x?: number; y?: number };
}

interface ArcgisResponse {
  features?: ArcgisFeature[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

export interface FetchUsfsOpts {
  fetcher?: typeof fetch;
  /** Override bounding box. Defaults to Western US. */
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

/** Build the URL for one page of the dispersed-camping query. */
export function buildUsfsQueryUrl(offset: number, bbox = WESTERN_US_BBOX): string {
  const params = new URLSearchParams({
    where: "markeractivity='Dispersed Camping'",
    outFields: '*',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    returnGeometry: 'true',
    outSR: '4326',
    inSR: '4326',
    // ArcGIS REST expects bbox geometry as a simple "xmin,ymin,xmax,ymax"
    // comma string (NOT a JSON envelope object) when paired with
    // geometryType=esriGeometryEnvelope. JSON-object form returns HTTP 400
    // with an empty error message — found out the hard way 2026-05-17.
    geometryType: 'esriGeometryEnvelope',
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    spatialRel: 'esriSpatialRelIntersects',
  });
  return `${USFS_QUERY_URL}?${params.toString()}`;
}

const RESTROOM_RE = /toilet|restroom|bathroom|vault/i;

/** Map one ArcGIS feature to our normalized DispersedSpot shape. */
export function mapUsfsFeature(feat: ArcgisFeature): DispersedSpot | null {
  const a = feat.attributes ?? {};
  const lng = toCoord(a.longitude) ?? feat.geometry?.x ?? null;
  const lat = toCoord(a.latitude) ?? feat.geometry?.y ?? null;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const id = a.recareaid !== undefined ? String(a.recareaid) : '';
  if (!id) return null;
  // USFS returns the description as raw HTML — strip to plain text before
  // the regex restroom check + before sending to the sheet.
  const description = stripHtml(a.recareadescription ?? '');
  const hasRestrooms = RESTROOM_RE.test(description);
  const name = (a.recareaname ?? '').trim() || `USFS Rec Area ${id}`;
  const agency = (a.forestname ?? '').trim() || 'USFS';
  // We don't use a.recareaurl — the legacy `?recid=<id>` URLs return HTTP
  // 200 but silently redirect to the forest's generic recreation page
  // after the 2024-25 fs.usda.gov redesign. Constructing a Google
  // site-search URL instead lands users on the actual rec-area page even
  // as USFS keeps shuffling URL patterns.
  return {
    source: 'USFS',
    id,
    name,
    lat,
    lng,
    description,
    agency,
    amenities: [],
    hasRestrooms,
    sourceUrl: buildAgencySearchUrl(name, agency, 'fs.usda.gov'),
    lastVerified: null,
  };
}

/**
 * Fetch all USFS dispersed-camping spots intersecting the bbox. Paginates
 * via `resultOffset` until ArcGIS stops setting `exceededTransferLimit`.
 * Throws on HTTP error or ArcGIS error response.
 */
export async function fetchUsfsDispersed(opts: FetchUsfsOpts = {}): Promise<DispersedSpot[]> {
  const fetcher = opts.fetcher ?? fetch;
  const bbox = opts.bbox ?? WESTERN_US_BBOX;
  const out: DispersedSpot[] = [];
  let offset = 0;
  for (;;) {
    const url = buildUsfsQueryUrl(offset, bbox);
    const resp = await fetcher(url);
    if (!resp.ok) throw new Error(`USFS fetch failed: HTTP ${resp.status}`);
    const data = (await resp.json()) as ArcgisResponse;
    if (data.error) throw new Error(`USFS API error: ${data.error.message ?? 'unknown'}`);
    const features = data.features ?? [];
    for (const f of features) {
      const spot = mapUsfsFeature(f);
      if (spot) out.push(spot);
    }
    if (!data.exceededTransferLimit || features.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset > 50000) break;  // hard safety cap; way more than expected
  }
  // Dedupe by recareaid — same rec area can appear with multiple activity tags.
  const byId = new Map<string, DispersedSpot>();
  for (const s of out) byId.set(s.id, s);
  return Array.from(byId.values());
}
