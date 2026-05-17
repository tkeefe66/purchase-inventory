import { WESTERN_US_BBOX } from './types.js';
import type { DispersedSpot } from './types.js';

/**
 * OpenStreetMap dispersed-camping data via the Overpass API.
 *
 * Pulls nodes + ways tagged `tourism=camp_site` or `camping=dispersed` in
 * the Western US bbox. ODbL license — attribution required when displaying
 * to users (the `agency` field is set to "OSM community" to make the source
 * visible).
 *
 * Overpass is shared community infrastructure; we set a descriptive
 * User-Agent and accept its rate limits.
 */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'outdoor-inventory-bot (https://github.com/personal/outdoor-inventory)';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number | string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
  remark?: string;
}

export interface FetchOsmOpts {
  fetcher?: typeof fetch;
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /** Override timeout passed to Overpass (seconds). Default 60. */
  timeoutSec?: number;
}

export function buildOverpassQuery(bbox = WESTERN_US_BBOX, timeoutSec = 60): string {
  const b = `(${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng})`;
  return `[out:json][timeout:${timeoutSec}];
(
  node["tourism"="camp_site"]${b};
  way["tourism"="camp_site"]${b};
  node["camping"="dispersed"]${b};
  way["camping"="dispersed"]${b};
);
out center tags;`;
}

/** Map one Overpass element to our normalized DispersedSpot shape. */
export function mapOsmElement(el: OverpassElement): DispersedSpot | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const tags = el.tags ?? {};
  // Skip private-access pins — we only want public/permissive land.
  if (tags['access'] === 'private') return null;
  // Skip explicitly paid sites — Rec.gov already covers fee campgrounds.
  if (tags['fee'] === 'yes') return null;

  const id = `osm-${el.type}-${el.id}`;
  const name = (tags['name'] ?? '').trim() ||
    (tags['camping'] === 'dispersed' ? 'OSM Dispersed Site' : 'OSM Camp Site');

  const operator = (tags['operator'] ?? '').trim();
  const agency = operator || 'OSM community';

  const amenities: string[] = [];
  if (tags['toilets'] === 'yes') amenities.push('toilets');
  if (tags['drinking_water'] === 'yes') amenities.push('drinking water');
  if (tags['fire_pit'] === 'yes' || tags['fireplace'] === 'yes') amenities.push('fire pit');
  if (tags['shower'] === 'yes') amenities.push('shower');
  if (tags['internet_access']) amenities.push('internet access');
  if (tags['camping'] === 'dispersed') amenities.push('dispersed');

  const description = (tags['description'] ?? '').trim();
  const hasRestrooms = tags['toilets'] === 'yes' || /toilet|restroom/i.test(description);

  const sourceUrl = tags['website'] ?? `https://www.openstreetmap.org/${el.type}/${el.id}`;

  // OSM stores last-edit dates per element but Overpass needs `out meta` to
  // expose them; tags `check_date` or `survey:date` are sometimes set by
  // mappers. Use whichever's available.
  const lastVerified = tags['check_date'] ?? tags['check_date:tourism'] ?? tags['survey:date'] ?? null;

  return {
    source: 'OSM',
    id,
    name,
    lat,
    lng: lon,
    description,
    agency,
    amenities,
    hasRestrooms,
    sourceUrl,
    lastVerified,
  };
}

export async function fetchOsmDispersed(opts: FetchOsmOpts = {}): Promise<DispersedSpot[]> {
  const fetcher = opts.fetcher ?? fetch;
  const query = buildOverpassQuery(opts.bbox, opts.timeoutSec);
  const resp = await fetcher(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) throw new Error(`OSM Overpass fetch failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as OverpassResponse;
  // Overpass returns `remark` in the body on partial/timeout responses with
  // a 200 status — surface those so the cron knows the snapshot is degraded.
  if (data.remark && /timed? ?out|error|exceeded/i.test(data.remark)) {
    throw new Error(`OSM Overpass remark: ${data.remark}`);
  }
  const elements = data.elements ?? [];
  const spots: DispersedSpot[] = [];
  for (const el of elements) {
    const spot = mapOsmElement(el);
    if (spot) spots.push(spot);
  }
  return spots;
}
