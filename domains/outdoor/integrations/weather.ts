import { formatInTimeZone } from 'date-fns-tz';

export interface ForecastInput {
  location: string;
  days: number;
}

export interface DailyForecast {
  date: string;
  tempHighF: number;
  tempLowF: number;
  precipProbability: number;
  precipAmountIn: number;
  windMaxMph: number;
  conditions: string;
}

export interface HourlyForecast {
  time: string;
  tempF: number;
  precipProbability: number;
  windMph: number;
  conditions: string;
}

export interface ForecastResult {
  resolved: { name: string; lat: number; lon: number; timezone: string };
  daily: DailyForecast[];
  hourlyTomorrow: HourlyForecast[];
}

export type ForecastErrorKind = 'no_match' | 'rate_limited' | 'api_error';

export class ForecastError extends Error {
  constructor(
    public readonly kind: ForecastErrorKind,
    public readonly service: 'nominatim' | 'pirateweather',
    public readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ForecastError';
  }
}

export interface WeatherClient {
  getForecast(input: ForecastInput): Promise<ForecastResult>;
}

export interface WeatherClientOptions {
  apiKey: string;
  /** Override for tests; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
  /** Override for tests; defaults to `Date.now`. */
  now?: () => number;
  /** Override for tests; defaults to `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PIRATE_WEATHER_URL = 'https://api.pirateweather.net/forecast';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

export interface PirateWeatherResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  daily?: { data: PirateDayData[] };
  hourly?: { data: PirateHourData[] };
}

interface PirateDayData {
  time: number;
  summary: string;
  temperatureHigh: number;
  temperatureLow: number;
  precipProbability: number;
  precipAccumulation: number;
  windSpeed: number;
}

export interface PirateHourData {
  time: number;
  summary: string;
  temperature: number;
  precipProbability: number;
  windSpeed: number;
}

function mapDaily(fc: PirateWeatherResponse, days: number): DailyForecast[] {
  const entries = fc.daily?.data ?? [];
  return entries.slice(0, days).map((d) => ({
    date: formatInTimeZone(d.time * 1000, fc.timezone, 'yyyy-MM-dd'),
    tempHighF: d.temperatureHigh,
    tempLowF: d.temperatureLow,
    precipProbability: d.precipProbability,
    precipAmountIn: d.precipAccumulation,
    windMaxMph: d.windSpeed,
    conditions: d.summary,
  }));
}

function destinationTomorrow(nowMs: number, tz: string): string {
  const todayStr = formatInTimeZone(nowMs, tz, 'yyyy-MM-dd');
  const nextMs = nowMs + 24 * 60 * 60 * 1000;
  let candidate = formatInTimeZone(nextMs, tz, 'yyyy-MM-dd');
  if (candidate === todayStr) {
    candidate = formatInTimeZone(nextMs + 60 * 60 * 1000, tz, 'yyyy-MM-dd');
  }
  return candidate;
}

function mapHourlyTomorrow(fc: PirateWeatherResponse, nowMs: number): HourlyForecast[] {
  const entries = fc.hourly?.data ?? [];
  const tz = fc.timezone;
  const targetDate = destinationTomorrow(nowMs, tz);
  return entries
    .filter((h) => formatInTimeZone(h.time * 1000, tz, 'yyyy-MM-dd') === targetDate)
    .map((h) => ({
      time: formatInTimeZone(h.time * 1000, tz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      tempF: h.temperature,
      precipProbability: h.precipProbability,
      windMph: h.windSpeed,
      conditions: h.summary,
    }));
}

export function createWeatherClient(opts: WeatherClientOptions): WeatherClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const NOMINATIM_MIN_GAP_MS = 1000;
  let lastNominatimAtMs = 0;
  const geocodeCache = new Map<string, { lat: number; lon: number; name: string }>();

  async function geocode(query: string): Promise<{ lat: number; lon: number; name: string }> {
    const key = query.trim().toLowerCase();
    const cached = geocodeCache.get(key);
    if (cached) return cached;
    const sinceLast = now() - lastNominatimAtMs;
    if (lastNominatimAtMs > 0 && sinceLast < NOMINATIM_MIN_GAP_MS) {
      await sleep(NOMINATIM_MIN_GAP_MS - sinceLast);
    }
    lastNominatimAtMs = now();
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'outdoor-inventory-bot/1.0 (tkeefe66@gmail.com)' },
    });
    if (!res.ok) {
      const kind: ForecastErrorKind = res.status === 429 ? 'rate_limited' : 'api_error';
      throw new ForecastError(kind, 'nominatim', res.status, `nominatim ${res.status}`);
    }
    const body = (await res.json()) as NominatimResult[];
    if (!Array.isArray(body) || body.length === 0) {
      throw new ForecastError('no_match', 'nominatim', undefined, `no match for "${query}"`);
    }
    const first = body[0]!;
    const lat = parseFloat(first.lat);
    const lon = parseFloat(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new ForecastError('no_match', 'nominatim', undefined, `invalid coordinates for "${query}"`);
    }
    const resolved = { lat, lon, name: first.display_name };
    geocodeCache.set(key, resolved);
    return resolved;
  }

  async function fetchForecast(lat: number, lon: number): Promise<PirateWeatherResponse> {
    const url = `${PIRATE_WEATHER_URL}/${opts.apiKey}/${lat},${lon}?units=us&exclude=minutely,alerts`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new ForecastError('api_error', 'pirateweather', res.status, `pirateweather ${res.status}`);
    }
    return (await res.json()) as PirateWeatherResponse;
  }

  return {
    async getForecast(input) {
      const { lat, lon, name } = await geocode(input.location);
      const fc = await fetchForecast(lat, lon);
      return {
        resolved: { name, lat, lon, timezone: fc.timezone },
        daily: mapDaily(fc, input.days),
        hourlyTomorrow: mapHourlyTomorrow(fc, now()),
      };
    },
  };
}
