import 'dotenv/config';
import { lookupTrail, searchTrailsNearby } from '../lib/integrations/trails.js';

/**
 * Live smoke test for the OSM Overpass trail adapter. Hits the real
 * Overpass endpoint and prints sample results so we can eyeball coverage
 * + quality.
 *
 *   npm run smoke-trails
 */
async function main(): Promise<void> {
  console.log('=== lookup_trail: "Manitou Incline" ===');
  const incline = await lookupTrail('Manitou Incline');
  console.log(`Got ${incline.length} match(es)`);
  for (const t of incline.slice(0, 5)) {
    console.log(`  ${t.name} — ${t.lengthKm}km ${t.surface ?? ''} difficulty=${t.difficulty ?? '-'} activities=${t.activities.join(',')}`);
    console.log(`    ${t.sourceUrl}`);
  }

  console.log('\n=== search_trails_nearby Boulder CO (hiking, 25km) ===');
  // Boulder, CO approx
  const hiking = await searchTrailsNearby({
    lat: 40.0150, lng: -105.2705, radiusKm: 25, activity: 'hiking',
  });
  console.log(`Got ${hiking.length} hiking trail(s) (showing top 10):`);
  for (const t of hiking.slice(0, 10)) {
    console.log(`  ${t.name} — ${t.lengthKm}km difficulty=${t.difficulty ?? '-'}`);
  }

  console.log('\n=== search_trails_nearby Boulder CO (mtb, 25km) ===');
  const mtb = await searchTrailsNearby({
    lat: 40.0150, lng: -105.2705, radiusKm: 25, activity: 'mtb',
  });
  console.log(`Got ${mtb.length} MTB trail(s) (showing top 10):`);
  for (const t of mtb.slice(0, 10)) {
    console.log(`  ${t.name} — ${t.lengthKm}km difficulty=${t.difficulty ?? '-'}`);
  }

  console.log('\nDone.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
