import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { createRecGovClient } from '../lib/reccgov/client.js';
import { createSheetsClient, mirrorCampingIndex } from '../lib/sheets.js';
import { readCampingIndex, writeCampingIndex } from '../lib/campingState.js';
import { parseAmenities } from '../lib/reccgov/amenityParser.js';

async function main(): Promise<void> {
  const anthropic = new Anthropic();
  const recgov = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const indexPath = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const idx = await readCampingIndex(indexPath);
  const active = idx.facilities.filter((f) => f.active);
  console.log(`Re-parsing amenities + restrictions for ${active.length} active facilities...`);

  let done = 0;
  for (const f of active) {
    try {
      const search = await recgov.searchFacility(f.facilityId);
      const description = search?.description ?? '';
      if (!description) { done++; continue; }
      const facts = await parseAmenities(description, anthropic);
      f.hasRestrooms = facts.hasRestrooms ?? f.hasRestrooms;
      f.restroomType = facts.restroomType;
      f.hasDrinkingWater = facts.hasDrinkingWater;
      if (facts.restrictions.length > 0) f.restrictions = facts.restrictions;
    } catch (err) {
      console.warn(`[refresh] ${f.facilityId} failed:`, err instanceof Error ? err.message : err);
    }
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${active.length}`);
  }

  console.log(`Writing JSON + mirroring to sheet...`);
  await writeCampingIndex(indexPath, idx);
  await mirrorCampingIndex(sheets, spreadsheetId, idx.facilities);
  console.log('Done.');
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
