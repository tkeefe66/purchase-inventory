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
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const PIRATE_WEATHER_URL = 'https://api.pirateweather.net/forecast';

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface PirateWeatherResponse {
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

interface PirateHourData {
  time: number;
  summary: string;
  temperature: number;
  precipProbability: number;
  windSpeed: number;
}

export function createWeatherClient(opts: WeatherClientOptions): WeatherClient {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const geocodeCache = new Map<string, { lat: number; lon: number; name: string }>();

  async function geocode(query: string): Promise<{ lat: number; lon: number; name: string }> {
    const key = query.trim().toLowerCase();
    const cached = geocodeCache.get(key);
    if (cached) return cached;
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'outdoor-inventory-bot/1.0 (tkeefe66@gmail.com)' },
    });
    if (!res.ok) {
      throw new ForecastError('api_error', 'nominatim', res.status, `nominatim ${res.status}`);
    }
    const body = (await res.json()) as NominatimResult[];
    if (!Array.isArray(body) || body.length === 0) {
      throw new ForecastError('no_match', 'nominatim', undefined, `no match for "${query}"`);
    }
    const first = body[0]!;
    const resolved = { lat: parseFloat(first.lat), lon: parseFloat(first.lon), name: first.display_name };
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
        daily: [],
        hourlyTomorrow: [],
      };
    },
  };
}
