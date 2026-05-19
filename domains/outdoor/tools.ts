import type { SheetsClient } from '../../lib/sheets.js';
import { STATUS_VALUES, type MasterRow, type Status } from '../../lib/types.js';
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import { itemId } from './types.js';
import type { WeatherClient, ForecastErrorKind, ForecastResult } from '../../lib/integrations/weather.js';
import { ForecastError } from '../../lib/integrations/weather.js';
import { searchFreeCampsites } from './integrations/freecamping.js';
import { readCampingIndex } from '../../lib/campingState.js';
import { readDispersedSnapshot } from '../../lib/dispersed/cache.js';
import { lookupTrail, searchTrailsNearby, type TrailInfo, type TrailActivity } from '../../lib/integrations/trails.js';

export interface ToolDeps {
  cache: InventoryCache;
  sheets: SheetsClient;
  spreadsheetId: string;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: Status },
  ) => Promise<void>;
  weather: WeatherClient;
  /** Resolve a free-text place name to coordinates. Throws on failure. */
  geocode: (query: string) => Promise<{ lat: number; lon: number; name: string }>;
  campingIndexPath: string;
  dispersedSnapshotPath: string;
}

export interface GetProductUrlInput {
  item_id: string;
}

export interface GetProductUrlResult {
  ok: boolean;
  product_url: string | null;
}

export interface UpdateStatusInput {
  item_id: string;
  new_status: Status;
}

export interface UpdateStatusResult {
  ok: boolean;
  message: string;
}

export interface GetForecastInput {
  location: string;
  days: number;
}

export type GetForecastResult =
  | { ok: true; forecast: ForecastResult }
  | { ok: false; error: ForecastErrorKind; message: string };

export interface FindFreeCampsitesInput {
  location: string;
  radius_km?: number;
  include_day_use?: boolean;
}

export type FindFreeCampsitesResult =
  | { ok: true; data: { location: string; coords: { lat: number; lon: number; name: string }; results: unknown } }
  | { ok: false; error: string };

export interface LookupTrailInput {
  name: string;
  near_location?: string;
  radius_km?: number;
}

export type LookupTrailResult =
  | { ok: true; trails: TrailInfo[] }
  | { ok: false; error: string };

export interface SearchTrailsNearbyInput {
  location: string;
  radius_km?: number;
  activity?: TrailActivity;
}

export type SearchTrailsNearbyResult =
  | { ok: true; data: { location: string; coords: { lat: number; lon: number; name: string }; trails: TrailInfo[] } }
  | { ok: false; error: string };

export interface ToolHandlers {
  get_product_url: (input: GetProductUrlInput) => Promise<GetProductUrlResult>;
  update_status: (input: UpdateStatusInput) => Promise<UpdateStatusResult>;
  get_forecast: (input: GetForecastInput) => Promise<GetForecastResult>;
  find_free_campsites: (input: FindFreeCampsitesInput) => Promise<FindFreeCampsitesResult>;
  lookup_trail: (input: LookupTrailInput) => Promise<LookupTrailResult>;
  search_trails_nearby: (input: SearchTrailsNearbyInput) => Promise<SearchTrailsNearbyResult>;
}

function humanForecastMessage(e: ForecastError, query: string): string {
  switch (e.kind) {
    case 'no_match':
      return `I couldn't find a location matching "${query}" — can you give me a state or country?`;
    case 'rate_limited':
      return 'Having trouble looking that up — try again in a moment.';
    case 'api_error':
      return 'Weather service is temporarily unavailable.';
  }
}

export const TOOL_SCHEMAS = [
  {
    name: 'get_product_url',
    description:
      "Look up the product URL for a specific inventory item by its 6-character id (the [id] in front of each row of the inventory in your system prompt). Use this when the user asks for a link, or when you want to point them at the product page.",
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The 6-char id from the inventory list.' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'update_status',
    description:
      "Update an inventory item's status. Use when Tom tells you he lost, sold, donated, retired, returned, or broke an item, or wants to mark it excluded. This writes to the sheet and immediately removes the item from your active inventory view if the new status is anything other than 'active'.",
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'The 6-char id from the inventory list.' },
        new_status: {
          type: 'string',
          enum: ['active', 'retired', 'returned', 'lost', 'broken', 'sold', 'donated', 'excluded'],
          description: 'The new status.',
        },
      },
      required: ['item_id', 'new_status'],
    },
  },
  {
    name: 'get_forecast',
    description:
      "Get the weather forecast for a location. Use when Tom asks about weather, packing for a trip, conditions at a destination, or anything that depends on temperature, precipitation, or wind. Returns a daily summary for the requested number of days plus an hourly breakdown for tomorrow at the destination. Use the destination's local time, not Tom's. Don't call this for general climate questions ('what's Iceland like in July?') — only for specific forecasts within the next 7 days.",
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'Free-form place name. Be as specific as helpful — "Moab, UT" beats "Moab". Country/state suffix avoids ambiguity for common names.',
        },
        days: {
          type: 'integer',
          minimum: 1,
          maximum: 7,
          description: 'Number of forecast days to return. Use 1 for "tomorrow", 3-5 for a multi-day trip, 7 for the full week.',
        },
      },
      required: ['location', 'days'],
    },
  },
  {
    name: 'find_free_campsites',
    description: 'Find free campsites within a radius of a location. Merges reservable Rec.gov sites that happen to be free with dispersed/walk-up sites from USFS, BLM, and OpenStreetMap. Tent-eligible only; picnic areas optional. Use when the user asks where to camp free near somewhere.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Place name to search near (e.g. "Moab, UT" or "Maroon Bells").' },
        radius_km: { type: 'integer', minimum: 1, maximum: 500, description: 'Search radius in km. Default 80 (~50 mi). Ask the user if unsure.' },
        include_day_use: { type: 'boolean', description: 'If true, also include picnic areas (day-use). Default false.' },
      },
      required: ['location'],
    },
  },
  {
    name: 'lookup_trail',
    description: 'Look up a specific trail by name. Returns OSM-tagged trail data: length, surface, difficulty (SAC scale for hiking, mtb:scale for MTB), suitable activities, and a map link. Use when the user names a specific trail ("Manitou Incline", "Devil\'s Backbone"). Data is community-tagged OpenStreetMap — coverage is good for named US trails but elevation gain is NOT included. For elevation or current conditions, use web_search.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Trail name as the user said it. Substring + case-insensitive match.' },
        near_location: { type: 'string', description: 'Optional — bias results to trails near this place name (e.g. "Boulder, CO"). Useful when multiple trails share a name.' },
        radius_km: { type: 'integer', minimum: 1, maximum: 500, description: 'When near_location is set, the bias radius. Default 50.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_trails_nearby',
    description: 'Find trails within a radius of a location, optionally filtered by activity (hiking, mtb, trail-running). Returns OSM-tagged trails with length, surface, and difficulty. Use for "good MTB trails near X" or "what\'s a trail-run option in Y under 10km" questions. Sorted by distance from the search point.',
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Place name to center the search on (e.g. "Boulder, CO").' },
        radius_km: { type: 'integer', minimum: 1, maximum: 200, description: 'Search radius in km. Default 25 (~16 mi).' },
        activity: { type: 'string', enum: ['hiking', 'mtb', 'trail-running'], description: 'Restrict to trails suitable for this activity. Omit to get a mixed list.' },
      },
      required: ['location'],
    },
  },
] as const;

const WEB_SEARCH_ALLOWED_DOMAINS = [
  // Retailers (pricing, stock, returns)
  'rei.com', 'backcountry.com', 'patagonia.com', 'evo.com', 'moosejaw.com',
  'competitivecyclist.com', 'nrs.com', 'jensonusa.com', 'amazon.com',
  'llbean.com', 'cabelas.com', 'basspro.com',
  // Expert reviews (product judgment)
  'outdoorgearlab.com', 'switchbacktravel.com', 'treelinereview.com',
  'gearjunkie.com', 'climbing.com', 'pinkbike.com', 'bikepacking.com',
  // Official / conditions (weather, regulations, trails, snow)
  'weather.gov', 'noaa.gov', 'nps.gov', 'fs.usda.gov', 'blm.gov',
  'recreation.gov', 'avalanche.org', 'alltrails.com', 'mountainproject.com',
  'opensnow.com',
] as const;

export const SERVER_TOOLS = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 3,
    allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS as unknown as string[],
  },
] as const;

export function createTools(deps: ToolDeps): ToolHandlers {
  return {
    async get_product_url(input: GetProductUrlInput): Promise<GetProductUrlResult> {
      const row = findRow(deps.cache.getSnapshot(), input.item_id);
      if (!row) return { ok: false, product_url: null };
      return { ok: true, product_url: row.productUrl };
    },

    async update_status(input: UpdateStatusInput): Promise<UpdateStatusResult> {
      if (!STATUS_VALUES.includes(input.new_status as Status)) {
        return { ok: false, message: `Invalid status: ${input.new_status}` };
      }
      const snapshot = deps.cache.getSnapshot();
      const rowPosition = findRowIndex(snapshot, input.item_id);
      if (rowPosition < 0) {
        return { ok: false, message: `Unknown item_id: ${input.item_id}` };
      }
      const sheetRowIndex = rowPosition + 2;
      await deps.updateRowStatus(deps.sheets, deps.spreadsheetId, {
        rowIndex: sheetRowIndex,
        newStatus: input.new_status,
      });
      const updated: MasterRow = { ...snapshot[rowPosition]!, status: input.new_status };
      deps.cache.applyLocalChange(updated);
      return { ok: true, message: `Marked ${updated.itemName} as ${input.new_status}` };
    },

    async get_forecast(input: GetForecastInput): Promise<GetForecastResult> {
      try {
        const forecast = await deps.weather.getForecast(input);
        return { ok: true, forecast };
      } catch (e) {
        if (e instanceof ForecastError) {
          return { ok: false, error: e.kind, message: humanForecastMessage(e, input.location) };
        }
        throw e;
      }
    },

    async find_free_campsites(input: FindFreeCampsitesInput): Promise<FindFreeCampsitesResult> {
      if (!input.location?.trim()) return { ok: false, error: 'location is required' };
      let coords: { lat: number; lon: number; name: string };
      try {
        coords = await deps.geocode(input.location);
      } catch {
        return { ok: false, error: 'could_not_geocode' };
      }
      const radiusKm = input.radius_km ?? 80;
      const index = await readCampingIndex(deps.campingIndexPath);
      const dispersed = (await readDispersedSnapshot(deps.dispersedSnapshotPath)) ?? { refreshedAt: '', spots: [] };
      const results = searchFreeCampsites({
        lat: coords.lat, lng: coords.lon, radiusKm,
        includeDayUse: input.include_day_use ?? false,
        index, dispersed,
      });
      return { ok: true, data: { location: input.location, coords, results } };
    },

    async lookup_trail(input: LookupTrailInput): Promise<LookupTrailResult> {
      if (!input.name?.trim()) return { ok: false, error: 'name is required' };
      const lookupOpts: Parameters<typeof lookupTrail>[1] = {};
      if (input.near_location) {
        try {
          const coords = await deps.geocode(input.near_location);
          lookupOpts.lat = coords.lat;
          lookupOpts.lng = coords.lon;
          if (input.radius_km !== undefined) lookupOpts.radiusKm = input.radius_km;
        } catch {
          // Fall through with un-biased query — better than erroring.
        }
      }
      try {
        const trails = await lookupTrail(input.name, lookupOpts);
        return { ok: true, trails };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'lookup_failed' };
      }
    },

    async search_trails_nearby(input: SearchTrailsNearbyInput): Promise<SearchTrailsNearbyResult> {
      if (!input.location?.trim()) return { ok: false, error: 'location is required' };
      let coords: { lat: number; lon: number; name: string };
      try {
        coords = await deps.geocode(input.location);
      } catch {
        return { ok: false, error: 'could_not_geocode' };
      }
      try {
        const trails = await searchTrailsNearby({
          lat: coords.lat,
          lng: coords.lon,
          radiusKm: input.radius_km ?? 25,
          ...(input.activity ? { activity: input.activity } : {}),
        });
        return { ok: true, data: { location: input.location, coords, trails } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'search_failed' };
      }
    },
  };
}

function findRow(snapshot: readonly MasterRow[], id: string): MasterRow | null {
  return snapshot.find((r) => itemId(r) === id) ?? null;
}

function findRowIndex(snapshot: readonly MasterRow[], id: string): number {
  return snapshot.findIndex((r) => itemId(r) === id);
}
