import { WESTERN_US_BBOX } from './types.js';
import type { DispersedSpot } from './types.js';
import { buildAgencySearchUrl } from './search-url.js';
import { stripHtml } from './text.js';

/**
 * Bureau of Land Management "BLM National Recreation Site Points" — Layer 4
 * is "Campsite - Primitive" (dispersed / walk-up sites on BLM-managed land).
 *
 * Layer index reference (from the MapServer root):
 *   2 = Campground (developed; overlaps Rec.gov, skip)
 *   3 = Campsite - Developed (overlaps Rec.gov, skip)
 *   4 = Campsite - Primitive  ← dispersed BLM sites, our target
 *
 * Data is US public domain — no auth.
 */
const BLM_QUERY_URL =
  'https://gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/4/query';

const PAGE_SIZE = 2000;

export interface BlmArcgisAttributes {
  OBJECTID?: number | string;
  FET_NAME?: string;
  FET_TYPE?: string;
  FET_SUBTYPE?: string;
  ADMIN_ST?: string;
  ADM_UNIT_CD?: string;
  UNIT_NAME?: string;
  DESCRIPTION?: string;
  WEB_LINK?: string;
  WEB_DISPLAY?: string | number | boolean;
  LAT?: number;
  LONG?: number;
}

interface ArcgisFeature {
  attributes: BlmArcgisAttributes;
  geometry?: { x?: number; y?: number };
}

interface ArcgisResponse {
  features?: ArcgisFeature[];
  exceededTransferLimit?: boolean;
  error?: { message?: string };
}

export interface FetchBlmOpts {
  fetcher?: typeof fetch;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

export function buildBlmQueryUrl(offset: number, bbox = WESTERN_US_BBOX): string {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    f: 'json',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    returnGeometry: 'true',
    outSR: '4326',
    inSR: '4326',
    // See note in usfs.ts — geometryType must be esriGeometryEnvelope and
    // geometry must be a simple comma string, NOT a JSON envelope object.
    geometryType: 'esriGeometryEnvelope',
    geometry: `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`,
    spatialRel: 'esriSpatialRelIntersects',
  });
  return `${BLM_QUERY_URL}?${params.toString()}`;
}

const RESTROOM_RE = /toilet|restroom|bathroom|vault/i;

export function mapBlmFeature(feat: ArcgisFeature): DispersedSpot | null {
  const a = feat.attributes ?? {};
  const lat = a.LAT ?? feat.geometry?.y;
  const lng = a.LONG ?? feat.geometry?.x;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const id = a.OBJECTID !== undefined ? String(a.OBJECTID) : '';
  if (!id) return null;
  // BLM's DESCRIPTION is usually null but occasionally has HTML; strip
  // defensively so the sheet never shows tag soup.
  const description = stripHtml(a.DESCRIPTION ?? '');
  // BLM dispersed sites are by definition primitive; rare to have restrooms,
  // but flag when description mentions one.
  const hasRestrooms = RESTROOM_RE.test(description);
  const unit = (a.UNIT_NAME ?? '').trim();
  const agency = unit ? `BLM ${unit}` : 'BLM';
  const name = (a.FET_NAME ?? '').trim() || `BLM Primitive Site ${id}`;
  // WEB_LINK is null on most BLM records; fall back to a Google site-search
  // URL that lands users on the actual page on blm.gov.
  const apiUrl = (a.WEB_LINK ?? '').trim();
  const sourceUrl = apiUrl || buildAgencySearchUrl(name, agency, 'blm.gov');
  return {
    source: 'BLM',
    id,
    name,
    lat,
    lng,
    description,
    agency,
    amenities: [],
    hasRestrooms,
    sourceUrl,
    lastVerified: null,
  };
}

export async function fetchBlmDispersed(opts: FetchBlmOpts = {}): Promise<DispersedSpot[]> {
  const fetcher = opts.fetcher ?? fetch;
  const bbox = opts.bbox ?? WESTERN_US_BBOX;
  const out: DispersedSpot[] = [];
  let offset = 0;
  for (;;) {
    const url = buildBlmQueryUrl(offset, bbox);
    const resp = await fetcher(url);
    if (!resp.ok) throw new Error(`BLM fetch failed: HTTP ${resp.status}`);
    const data = (await resp.json()) as ArcgisResponse;
    if (data.error) throw new Error(`BLM API error: ${data.error.message ?? 'unknown'}`);
    const features = data.features ?? [];
    for (const f of features) {
      const spot = mapBlmFeature(f);
      if (spot) out.push(spot);
    }
    if (!data.exceededTransferLimit || features.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    if (offset > 50000) break;
  }
  const byId = new Map<string, DispersedSpot>();
  for (const s of out) byId.set(s.id, s);
  return Array.from(byId.values());
}
