import 'dotenv/config';
import { createWeatherClient } from '../domains/outdoor/integrations/weather.js';

const key = process.env.PIRATE_WEATHER_API_KEY;
if (!key) {
  console.error('PIRATE_WEATHER_API_KEY not set');
  process.exit(1);
}

const client = createWeatherClient({ apiKey: key });

async function run(): Promise<void> {
  console.log('--- Moab, UT (2 days) ---');
  const moab = await client.getForecast({ location: 'Moab, UT', days: 2 });
  console.log('Resolved:', moab.resolved);
  console.log('Daily:');
  for (const d of moab.daily) {
    console.log(`  ${d.date}: ${d.tempLowF}–${d.tempHighF}°F, precip ${Math.round(d.precipProbability * 100)}% (${d.precipAmountIn}in), wind ${d.windMaxMph}mph — ${d.conditions}`);
  }
  console.log(`Hourly tomorrow entries: ${moab.hourlyTomorrow.length}`);
  if (moab.hourlyTomorrow[0]) console.log('  First hour:', moab.hourlyTomorrow[0]);

  console.log('\n--- Reykjavik (3 days) ---');
  const rk = await client.getForecast({ location: 'Reykjavik, Iceland', days: 3 });
  console.log('Resolved:', rk.resolved);
  console.log(`Daily count: ${rk.daily.length}`);
  for (const d of rk.daily) {
    console.log(`  ${d.date}: ${d.tempLowF}–${d.tempHighF}°F — ${d.conditions}`);
  }

  console.log('\n--- gibberish (should error) ---');
  try {
    await client.getForecast({ location: 'asdfqwertyxyz123', days: 1 });
    console.log('UNEXPECTED: no error');
  } catch (e: unknown) {
    const err = e as { kind?: string; service?: string; message?: string };
    console.log(`Got error kind: ${err.kind} / service: ${err.service} / message: ${err.message}`);
  }
}

run().catch((e: unknown) => {
  console.error('FATAL:', e);
  process.exit(1);
});
