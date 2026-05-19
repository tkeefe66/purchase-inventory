// `suncalc` is a CommonJS module with no ESM named exports. Default-import +
// destructure works under both Node's strict ESM loader (tsx in prod) and
// Vite's permissive loader (vitest).
import suncalc from 'suncalc';
const { getTimes } = suncalc;

export type SunTimes =
  | {
      ok: true;
      date: string;
      sunrise: string;
      sunset: string;
      solarNoon: string;
      civilDawn: string;
      civilDusk: string;
      goldenHourMorning: { start: string; end: string };
      goldenHourEvening: { start: string; end: string };
      blueHourMorning: { start: string; end: string };
      blueHourEvening: { start: string; end: string };
    }
  | {
      ok: false;
      error: 'bad_coords' | 'bad_date';
    };

export function getSunTimes(lat: number, lng: number, dateISO: string): SunTimes {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'bad_coords' };
  }
  const date = new Date(dateISO + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'bad_date' };
  }
  const t = getTimes(date, lat, lng);
  return {
    ok: true,
    date: dateISO,
    sunrise: t.sunrise.toISOString(),
    sunset: t.sunset.toISOString(),
    solarNoon: t.solarNoon.toISOString(),
    civilDawn: t.dawn.toISOString(),
    civilDusk: t.dusk.toISOString(),
    goldenHourMorning: { start: t.dawn.toISOString(), end: t.goldenHourEnd.toISOString() },
    goldenHourEvening: { start: t.goldenHour.toISOString(), end: t.dusk.toISOString() },
    blueHourMorning: { start: t.nightEnd.toISOString(), end: t.dawn.toISOString() },
    blueHourEvening: { start: t.dusk.toISOString(), end: t.night.toISOString() },
  };
}
