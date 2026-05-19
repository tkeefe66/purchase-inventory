/**
 * Tool schemas + handlers for the photography agent.
 *
 * Mirrors domains/outdoor/tools.ts, but the toolset is photography-focused:
 *   - shared with outdoor: get_forecast, lookup_trail, search_trails_nearby
 *   - new for photography: get_sun_times (golden/blue hour planning),
 *     get_active_assignment, list_topics, get_topic_theory
 *
 * Deliberately NOT included:
 *   - start_assignment / mark_topic_complete — those stay slash-command-only
 *     so Tom always explicitly acknowledges state changes via /start, /skip.
 *   - find_free_campsites, update_status, get_product_url — outdoor only.
 */

import {
  searchTrailsNearby,
  lookupTrail,
  type TrailActivity,
  type TrailInfo,
} from '../../lib/integrations/trails.js';
import {
  geocode,
  type WeatherClient,
  type ForecastResult,
} from '../../lib/integrations/weather.js';
import { getSunTimes, type SunTimes } from '../../lib/integrations/sunTimes.js';
import {
  ALL_TOPICS,
  getTopicById,
  type BranchId,
  type Tier,
  type Topic,
} from './skillTree.js';
import { computeStatuses, type ProgressEntry } from './curriculum.js';
import type {
  AssignmentRow,
  ProgressRow,
  ProgressStatus,
} from '../../lib/photographySheets.js';
import type { ExpanderDeps } from './expander.js';
import { expandLesson } from './expander.js';

// ─── Input / output types ────────────────────────────────────────────────

export interface GetForecastInput { location: string; days?: number; }
export type GetForecastResult =
  | { ok: true; data: ForecastResult }
  | { ok: false; error: string };

export interface LookupTrailInput { name: string; near_location?: string; radius_km?: number; }
export type LookupTrailResult =
  | { ok: true; trails: TrailInfo[] }
  | { ok: false; error: string };

export interface SearchTrailsNearbyInput { location: string; radius_km?: number; activity?: TrailActivity; }
export type SearchTrailsNearbyResult =
  | { ok: true; data: { location: string; coords: { lat: number; lon: number; name: string }; trails: TrailInfo[] } }
  | { ok: false; error: string };

export interface GetSunTimesInput { location: string; date?: string; }
export type GetSunTimesResult =
  | { ok: true; data: { location: string; coords: { lat: number; lon: number }; times: SunTimes } }
  | { ok: false; error: string };

export interface GetActiveAssignmentResult {
  active: AssignmentRow | null;
}

export interface ListTopicsInput {
  branch?: BranchId;
  tier?: Tier;
  status?: ProgressStatus;
}
export interface ListTopicsResult {
  topics: Array<{
    id: string;
    branch: BranchId;
    tier: Tier;
    name: string;
    description: string;
    status: ProgressStatus;
    prereqs: string[];
  }>;
  total: number;
}

export interface GetTopicTheoryInput { topic_id: string; }
export type GetTopicTheoryResult =
  | { ok: true; topic_id: string; name: string; lesson: string }
  | { ok: false; error: string };

// ─── Tool schemas ────────────────────────────────────────────────────────

export const TOOL_SCHEMAS = [
  {
    name: 'get_forecast',
    description:
      "Get a multi-day forecast for a place. Use when Tom asks 'is Saturday clear for landscape shooting?' or 'will it rain when I'm in Denver Thursday?' Pair with sun-times if golden hour timing matters. Returns daily highs/lows, precip prob + amount, wind, conditions, plus tomorrow's hourly forecast. days defaults to 7.",
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Place name to forecast (e.g. "Boulder, CO" or "Chautauqua Park").' },
        days: { type: 'integer', minimum: 1, maximum: 14, description: 'How many days of forecast to return. Default 7.' },
      },
      required: ['location'],
    },
  },
  {
    name: 'lookup_trail',
    description:
      "Look up a specific named trail / overlook / shoot spot from OpenStreetMap. Returns trail length, surface, difficulty, suitable activities, map link. Use when Tom names a place ('what's Mt Sanitas like for sunset?'). For elevation gain or current conditions, follow up with web_search — OSM doesn't carry those.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Trail or place name.' },
        near_location: { type: 'string', description: 'Optional bias (e.g. "Boulder, CO") when multiple trails share a name.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_trails_nearby',
    description:
      "Find trails / shoot locations within a radius of a place. Use when Tom asks 'where should I shoot landscape near Boulder?' or 'good wildlife spots within an hour of here'. Sorted by distance — typically suggest 3-5 of the closest. Cite the OSM map link with each suggestion.",
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Place name to search around (e.g. "Boulder, CO").' },
        radius_km: { type: 'integer', minimum: 1, maximum: 200, description: 'Search radius in km. Default 25.' },
        activity: { type: 'string', enum: ['hiking', 'mtb', 'trail-running'], description: 'Optional activity filter.' },
      },
      required: ['location'],
    },
  },
  {
    name: 'get_sun_times',
    description:
      "Get sunrise, sunset, golden hour, blue hour, and civil twilight for a place and date. ESSENTIAL for any 'when should I shoot?' question. Returns ISO timestamps in UTC — convert to Mountain Time when telling Tom (he's in Boulder). date defaults to today (Mountain Time). Format the time as 'h:mm AM/PM MT' in your reply.",
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Place to compute sun times for (e.g. "Boulder, CO").' },
        date: { type: 'string', description: "Date as YYYY-MM-DD. Default: today in Mountain Time." },
      },
      required: ['location'],
    },
  },
  {
    name: 'get_active_assignment',
    description:
      "Get Tom's currently-active assignment row (if any). Returns the topic id, assignment text, rubric, status, and submission state. Use when he asks 'what am I working on?' or to give targeted advice about his current assignment.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_topics',
    description:
      "List photography curriculum topics, optionally filtered by branch ('operating-camera' | 'seeing' | 'editing' | 'printing'), tier (1-4), or status. Use to answer 'what should I learn next?', 'what's left in Operating Camera?', 'what topics involve light?' Includes computed status (locked / available / in-progress / completed / skipped) per topic. Use sparingly — don't dump all 58 topics at once.",
    input_schema: {
      type: 'object',
      properties: {
        branch: { type: 'string', enum: ['operating-camera', 'seeing', 'editing', 'printing'], description: 'Restrict to one branch.' },
        tier: { type: 'integer', enum: [1, 2, 3, 4], description: 'Restrict to one tier within a branch.' },
        status: { type: 'string', enum: ['locked', 'available', 'in-progress', 'completed', 'skipped'], description: 'Restrict to a particular status.' },
      },
    },
  },
  {
    name: 'get_topic_theory',
    description:
      "Get the full Claude-expanded theory lesson for a topic. Use sparingly — only when Tom specifically wants to learn a topic in depth in conversation (vs running `/learn <id>`). Returns markdown prose.",
    input_schema: {
      type: 'object',
      properties: {
        topic_id: { type: 'string', description: 'Topic id, e.g. "operating-camera.exposure-triangle".' },
      },
      required: ['topic_id'],
    },
  },
] as const;

// Web search server tool — photography-focused allowed domains.
const PHOTO_WEB_SEARCH_DOMAINS = [
  // Reviews + tutorials
  'dpreview.com', 'petapixel.com', 'fstoppers.com', 'photographylife.com',
  'kenrockwell.com', 'thephoblographer.com', 'digital-photography-school.com',
  // Manufacturers + official docs
  'sony.com', 'sonyalpha.com', 'sigmaphoto.com', 'epson.com', 'epsonprint.com',
  'helpx.adobe.com', 'adobe.com', 'lightroomqueen.com',
  // Retailers (for gear specs + pricing)
  'bhphotovideo.com', 'adorama.com', 'mpb.com',
  // Paper + print
  'redrivercatalog.com', 'hahnemuhle.com', 'canson-infinity.com', 'ilford.com',
  'shop.hahnemuehle.com', 'redrivercatalog.com',
  // Community
  'reddit.com', 'youtube.com',
] as const;

export const SERVER_TOOLS = [
  {
    type: 'web_search_20260209',
    name: 'web_search',
    max_uses: 3,
    allowed_domains: PHOTO_WEB_SEARCH_DOMAINS as unknown as string[],
  },
] as const;

// ─── Handler factory ────────────────────────────────────────────────────

export interface ToolDeps {
  weather: WeatherClient;
  geocode: typeof geocode;
  /** Pulls active assignment from the sheet. */
  getActiveAssignment: () => Promise<AssignmentRow | null>;
  /** Pulls full Progress rows for status computation. */
  readProgress: () => Promise<ProgressRow[]>;
  /** Used by get_topic_theory; builds with current inventory context. */
  expanderDeps: ExpanderDeps;
}

export interface ToolHandlers {
  get_forecast: (input: GetForecastInput) => Promise<GetForecastResult>;
  lookup_trail: (input: LookupTrailInput) => Promise<LookupTrailResult>;
  search_trails_nearby: (input: SearchTrailsNearbyInput) => Promise<SearchTrailsNearbyResult>;
  get_sun_times: (input: GetSunTimesInput) => Promise<GetSunTimesResult>;
  get_active_assignment: () => Promise<GetActiveAssignmentResult>;
  list_topics: (input: ListTopicsInput) => Promise<ListTopicsResult>;
  get_topic_theory: (input: GetTopicTheoryInput) => Promise<GetTopicTheoryResult>;
}

function progressEntriesFromRows(rows: readonly ProgressRow[]): Map<string, ProgressEntry> {
  const m = new Map<string, ProgressEntry>();
  for (const r of rows) {
    m.set(r.topicId, {
      topicId: r.topicId,
      status: r.status,
      lastActivityAt: r.lastActivityAt,
      assignmentsPassed: r.assignmentsPassed,
      assignmentsFailed: r.assignmentsFailed,
      theoryLastReadAt: r.theoryLastReadAt,
    });
  }
  return m;
}

export function createTools(deps: ToolDeps): ToolHandlers {
  return {
    async get_forecast(input) {
      if (!input.location?.trim()) return { ok: false, error: 'location is required' };
      try {
        const data = await deps.weather.getForecast({ location: input.location, days: input.days ?? 7 });
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'forecast_failed' };
      }
    },

    async lookup_trail(input) {
      if (!input.name?.trim()) return { ok: false, error: 'name is required' };
      const opts: Parameters<typeof lookupTrail>[1] = {};
      if (input.near_location) {
        try {
          const coords = await deps.geocode(input.near_location);
          opts.lat = coords.lat;
          opts.lng = coords.lon;
          if (input.radius_km !== undefined) opts.radiusKm = input.radius_km;
        } catch {
          // Continue unbiased
        }
      }
      try {
        const trails = await lookupTrail(input.name, opts);
        return { ok: true, trails };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'lookup_failed' };
      }
    },

    async search_trails_nearby(input) {
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

    async get_sun_times(input) {
      if (!input.location?.trim()) return { ok: false, error: 'location is required' };
      let coords: { lat: number; lon: number };
      try {
        coords = await deps.geocode(input.location);
      } catch {
        return { ok: false, error: 'could_not_geocode' };
      }
      const date = input.date?.trim() || new Date().toISOString().slice(0, 10);
      const times = getSunTimes(coords.lat, coords.lon, date);
      return { ok: true, data: { location: input.location, coords, times } };
    },

    async get_active_assignment() {
      const active = await deps.getActiveAssignment();
      return { active };
    },

    async list_topics(input) {
      const rows = await deps.readProgress();
      const progress = progressEntriesFromRows(rows);
      const statuses = computeStatuses(progress);
      let candidates: Topic[] = [...ALL_TOPICS];
      if (input.branch) candidates = candidates.filter((t) => t.branch === input.branch);
      if (input.tier !== undefined) candidates = candidates.filter((t) => t.tier === input.tier);
      const out = candidates.map((t) => ({
        id: t.id,
        branch: t.branch,
        tier: t.tier,
        name: t.name,
        description: t.description,
        status: statuses.get(t.id) ?? 'locked',
        prereqs: t.prereqs,
      }));
      const filtered = input.status ? out.filter((t) => t.status === input.status) : out;
      return { topics: filtered, total: filtered.length };
    },

    async get_topic_theory(input) {
      const topic = getTopicById(input.topic_id);
      if (!topic) return { ok: false, error: `Unknown topic_id: ${input.topic_id}` };
      try {
        const lesson = await expandLesson(deps.expanderDeps, topic);
        return { ok: true, topic_id: topic.id, name: topic.name, lesson };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'expansion_failed' };
      }
    },
  };
}
