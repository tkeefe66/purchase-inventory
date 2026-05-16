import 'dotenv/config';
import { createRecGovClient } from '../lib/reccgov/client.js';

async function main(): Promise<void> {
  const client = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  console.log('Fetching first 5 CO facilities...');
  const list = await client.searchFacilities({ state: 'CO', limit: 5 });
  for (const f of list) {
    console.log(`  ${f.facilityId}  ${f.name}  (${f.parentUnit})`);
  }
  if (list[0]?.facilityId) {
    console.log('\nFetching first facility details...');
    const detail = await client.getFacility(list[0].facilityId);
    console.log(JSON.stringify(detail, null, 2).slice(0, 500));
    const campsites = await client.getFacilityCampsites(list[0].facilityId);
    console.log(`\nCampsites: ${campsites.length} (sample: ${campsites.slice(0, 3).map((c) => c.campsiteType).join(', ')})`);
  }
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
