import { describe, test, expect } from 'vitest';
import {
  createWeatherClient,
  ForecastError,
} from '../../../../domains/outdoor/integrations/weather.js';

describe('weather module', () => {
  test('exports load', () => {
    expect(typeof createWeatherClient).toBe('function');
    expect(ForecastError).toBeDefined();
  });
});
