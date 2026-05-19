/**
 * Phase 4 — trail data integration.
 *
 * AllTrails was the original target but their MCP server is claude.ai-only
 * (no API-consumer endpoint) and their REST API is closed + DataDome-
 * protected. Decision 2026-05-17: ship with OpenStreetMap via the Overpass
 * API for v1, with a thin adapter seam so AllTrails can drop in later if
 * they ever ship partner API access.
 *
 * OSM trail coverage in the Western US is solid for named trails. Length
 * is computed from the way geometry. Difficulty comes from `sac_scale`
 * (hiking, T1-T6) or `mtb:scale` (MTB, 0-6). Surface from `surface`. We
 * deliberately skip elevation gain because OSM doesn't carry it — the
 * agent can fall back to web_search if the user asks specifically.
 *
 * ODbL license — attribution required. Each TrailInfo includes a
 * `sourceUrl` pointing back to openstreetmap.org so the source is visible.
 */

export type TrailActivity = 'hiking' | 'mtb' | 'trail-running';

export interface TrailInfo {
  /** Source-local ID, e.g. "osm-way-12345". */
  id: string;
  name: string;
  /** Centroid of the trail's geometry. */
  lat: number;
  lng: number;
  /** Trail length in km, computed by Haversine sum over the way's nodes. */
  lengthKm: number | null;
  /** OSM `surface` tag (dirt, gravel, paved, etc.). May be null. */
  surface: string | null;
  /** Difficulty string when known: SAC hiking scale (T1-T6) or MTB scale (0-6). */
  difficulty: string | null;
  /** Which activities this trail is suitable for, derived from tags. */
  activities: TrailActivity[];
  /** Link back to openstreetmap.org for the way. */
  sourceUrl: string;
  /** Free-text description if the mappers added one (often null). */
  description: string | null;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'outdoor-inventory-bot (https://github.com/personal/outdoor-inventory)';

/** Minimum trail length in km for `searchTrailsNearby` to surface a result.
 *  Filters out the urban-path noise that OSM has in dense city centers
 *  (campus shortcuts, bridge spans, 50m sidewalk segments). */
const MIN_TRAIL_LENGTH_KM = 0.5;

export interface SearchNearbyOpts {
  lat: number;
  lng: number;
  radiusKm: number;
  activity?: TrailActivity;
  fetcher?: typeof fetch;
  /** Overpass server-side timeout in seconds. Default 30. */
  timeoutSec?: number;
}

export interface LookupTrailOpts {
  /** Optional centerpoint to bias results geographically. */
  lat?: number;
  lng?: number;
  radiusKm?: number;
  fetcher?: typeof fetch;
}

/**
 * The shape Overpass returns when we ask for full geometry. Subset of fields
 * we actually use.
 */
export interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

interface OverpassResponse {
  elements?: OverpassWay[];
  remark?: string;
}

function activityClause(activity: TrailActivity | undefined): string {
  // Each line is one OSM way matcher. Union via Overpass `( ... );`.
  switch (activity) {
    case 'mtb':
      return `
        way["mtb:scale"](around:RADIUS_M,LAT,LNG);
        way["mtb"="yes"](around:RADIUS_M,LAT,LNG);
        way["highway"="path"]["bicycle"="yes"](around:RADIUS_M,LAT,LNG);
      `;
    case 'hiking':
      // hiking-specific signal is sac_scale; also include named paths.
      return `
        way["sac_scale"](around:RADIUS_M,LAT,LNG);
        way["highway"="path"]["name"](around:RADIUS_M,LAT,LNG);
      `;
    case 'trail-running':
      // Same surface as hiking; agent narrows by length.
      return `
        way["highway"="path"]["name"](around:RADIUS_M,LAT,LNG);
      `;
    default:
      // Generic — return both hiking and MTB candidates.
      return `
        way["highway"="path"]["name"](around:RADIUS_M,LAT,LNG);
        way["mtb:scale"](around:RADIUS_M,LAT,LNG);
      `;
  }
}

export function buildSearchNearbyQuery(opts: SearchNearbyOpts): string {
  const radiusM = Math.round(opts.radiusKm * 1000);
  const clause = activityClause(opts.activity)
    .replace(/RADIUS_M/g, String(radiusM))
    .replace(/LAT/g, opts.lat.toFixed(6))
    .replace(/LNG/g, opts.lng.toFixed(6));
  const timeoutSec = opts.timeoutSec ?? 30;
  return `[out:json][timeout:${timeoutSec}];
(
${clause.trim()}
);
out geom tags;`;
}

// Default CONUS bbox (south, west, north, east) when no center is given.
// Without a bounded set Overpass times out on global `way[name~...]` scans.
const CONUS_BBOX = '24.0,-125.0,50.0,-66.0';

export function buildLookupByNameQuery(name: string, opts: LookupTrailOpts): string {
  // Performance: Overpass regex scans on `name` across CONUS reliably time
  // out. Exact-match `name="X"` uses the name index directly and is
  // sub-second. We accept the precision tradeoff (user must type the name
  // close to how OSM mappers tagged it) for reliability. The agent can
  // re-query with slight variations if the first exact match misses.
  const escaped = name.replace(/["\\]/g, '\\$&');
  const scope = (opts.lat !== undefined && opts.lng !== undefined)
    ? `(around:${Math.round((opts.radiusKm ?? 50) * 1000)},${opts.lat.toFixed(6)},${opts.lng.toFixed(6)})`
    : `(${CONUS_BBOX})`;
  return `[out:json][timeout:30];
(
  way["name"="${escaped}"]${scope};
  way["name:en"="${escaped}"]${scope};
);
out geom tags;`;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180;
  const lb = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function computeLengthKm(geometry: readonly { lat: number; lon: number }[]): number | null {
  if (geometry.length < 2) return null;
  let total = 0;
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1]!;
    const b = geometry[i]!;
    total += haversineKm({ lat: a.lat, lng: a.lon }, { lat: b.lat, lng: b.lon });
  }
  return Math.round(total * 100) / 100;
}

function centroidOf(geometry: readonly { lat: number; lon: number }[]): { lat: number; lng: number } | null {
  if (geometry.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (const g of geometry) { sumLat += g.lat; sumLng += g.lon; }
  return { lat: sumLat / geometry.length, lng: sumLng / geometry.length };
}

function deriveActivities(tags: Record<string, string>): TrailActivity[] {
  const out = new Set<TrailActivity>();
  if (tags['highway'] === 'path' || tags['sac_scale']) {
    out.add('hiking');
    out.add('trail-running');
  }
  if (tags['mtb:scale'] || tags['mtb'] === 'yes' || tags['bicycle'] === 'yes') {
    out.add('mtb');
  }
  // Fallback: if nothing matched but we got the way at all, treat as hiking.
  if (out.size === 0) out.add('hiking');
  return Array.from(out);
}

export function mapOsmWay(way: OverpassWay): TrailInfo | null {
  const tags = way.tags ?? {};
  // Skip private-access trails.
  if (tags['access'] === 'private' || tags['foot'] === 'private') return null;
  const name = (tags['name'] ?? '').trim();
  if (!name) return null;
  const geom = way.geometry ?? [];
  const centroid = centroidOf(geom);
  if (!centroid) return null;
  return {
    id: `osm-way-${way.id}`,
    name,
    lat: centroid.lat,
    lng: centroid.lng,
    lengthKm: computeLengthKm(geom),
    surface: tags['surface'] ?? null,
    difficulty: tags['sac_scale'] ?? tags['mtb:scale'] ?? null,
    activities: deriveActivities(tags),
    sourceUrl: `https://www.openstreetmap.org/way/${way.id}`,
    description: tags['description'] ?? null,
  };
}

/**
 * Use Nominatim's indexed full-text search to find OSM way IDs for a trail
 * name. Far more robust than scanning Overpass directly — Nominatim handles
 * synonyms, partial matches, and tag inconsistencies (e.g. Manitou Incline
 * is tagged in OSM as just "The Incline" with `highway=steps`).
 *
 * Returns at most `limit` candidate way IDs sorted by Nominatim's importance.
 * Filters to highway-class results (paths, steps, tracks, footways) since
 * trails are virtually always tagged that way.
 */
export interface NominatimTrailCandidate {
  osmId: number;
  lat: number;
  lon: number;
  displayName: string;
}

export async function nominatimSearchTrail(
  name: string,
  fetcher: typeof fetch,
  limit = 5,
): Promise<NominatimTrailCandidate[]> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', name);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(Math.max(limit * 3, 10))); // overfetch + filter
  url.searchParams.set('countrycodes', 'us');
  const resp = await fetcher(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!resp.ok) throw new Error(`Nominatim fetch failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as Array<{
    osm_type?: string; osm_id?: number; class?: string;
    lat?: string; lon?: string; display_name?: string;
  }>;
  const out: NominatimTrailCandidate[] = [];
  for (const r of data) {
    if (r.osm_type !== 'way') continue;
    if (r.class !== 'highway') continue;
    if (typeof r.osm_id !== 'number') continue;
    out.push({
      osmId: r.osm_id,
      lat: parseFloat(r.lat ?? '0'),
      lon: parseFloat(r.lon ?? '0'),
      displayName: r.display_name ?? '',
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function buildLookupByIdsQuery(osmIds: readonly number[]): string {
  if (osmIds.length === 0) return '';
  return `[out:json][timeout:25];
(
${osmIds.map((id) => `  way(${id});`).join('\n')}
);
out geom tags;`;
}

async function postOverpass(query: string, fetcher: typeof fetch): Promise<OverpassResponse> {
  const resp = await fetcher(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!resp.ok) throw new Error(`Overpass fetch failed: HTTP ${resp.status}`);
  const data = (await resp.json()) as OverpassResponse;
  if (data.remark && /timed? ?out|error|exceeded/i.test(data.remark)) {
    throw new Error(`Overpass remark: ${data.remark}`);
  }
  return data;
}

/**
 * Find trails within `radiusKm` of (lat,lng). Returns up to ~50 trails,
 * sorted by ascending distance from the search point. Drops urban path
 * noise (segments under MIN_TRAIL_LENGTH_KM) and dedupes by name to
 * collapse multi-segment OSM ways back into one row.
 */
export async function searchTrailsNearby(opts: SearchNearbyOpts): Promise<TrailInfo[]> {
  const fetcher = opts.fetcher ?? fetch;
  const query = buildSearchNearbyQuery(opts);
  const data = await postOverpass(query, fetcher);
  const center = { lat: opts.lat, lng: opts.lng };
  const trails: TrailInfo[] = [];
  for (const el of data.elements ?? []) {
    const t = mapOsmWay(el);
    if (t) trails.push(t);
  }
  // Dedupe by id (a way can match multiple clauses) then by name (collapse
  // OSM segmentation noise — one trail often spans 5-10 named ways).
  const byId = new Map<string, TrailInfo>();
  for (const t of trails) byId.set(t.id, t);
  const byName = new Map<string, TrailInfo>();
  for (const t of byId.values()) {
    const existing = byName.get(t.name);
    if (!existing) {
      byName.set(t.name, t);
    } else {
      // Sum segment lengths; round to 2 decimals to avoid float accumulation.
      const total = (existing.lengthKm ?? 0) + (t.lengthKm ?? 0);
      const combined: TrailInfo = {
        ...t,
        lengthKm: Math.round(total * 100) / 100,
      };
      byName.set(t.name, combined);
    }
  }
  return Array.from(byName.values())
    .filter((t) => (t.lengthKm ?? 0) >= MIN_TRAIL_LENGTH_KM)
    .sort((a, b) => haversineKm(center, a) - haversineKm(center, b))
    .slice(0, 50);
}

/**
 * Look up a specific named trail. Uses Nominatim's indexed full-text search
 * to find candidate OSM way IDs (handles the "Manitou Incline → 'The Incline'"
 * naming gap), then fetches their full geometry + tags from Overpass.
 *
 * When opts.lat/lng is provided, it's appended to the search query as a hint
 * (Nominatim prefers nearby results) — but we don't filter by distance since
 * the user may be far from the trail when asking about it.
 */
export async function lookupTrail(name: string, opts: LookupTrailOpts = {}): Promise<TrailInfo[]> {
  const fetcher = opts.fetcher ?? fetch;
  const query = (opts.lat !== undefined && opts.lng !== undefined)
    ? `${name} near ${opts.lat.toFixed(3)},${opts.lng.toFixed(3)}`
    : name;
  const candidates = await nominatimSearchTrail(query, fetcher, 5);
  if (candidates.length === 0) return [];

  const osmIds = candidates.map((c) => c.osmId);
  const overpassQuery = buildLookupByIdsQuery(osmIds);
  const data = await postOverpass(overpassQuery, fetcher);
  const trails: TrailInfo[] = [];
  for (const el of data.elements ?? []) {
    const t = mapOsmWay(el);
    if (t) trails.push(t);
  }
  const byId = new Map<string, TrailInfo>();
  for (const t of trails) byId.set(t.id, t);
  return Array.from(byId.values());
}
