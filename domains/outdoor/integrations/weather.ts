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

export function createWeatherClient(_opts: WeatherClientOptions): WeatherClient {
  throw new Error('not implemented');
}
