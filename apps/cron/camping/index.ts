import 'dotenv/config';
import { formatInTimeZone } from 'date-fns-tz';
import {
  shouldRunIndexRefresh,
  shouldRunMetadataRefresh,
  shouldRunNudgeTick,
} from './schedule.js';
import { createRecGovClient } from '../../../lib/reccgov/client.js';
import { createSheetsClient } from '../../../lib/sheets.js';
import { readMutedFacilityIds } from '../../../lib/sheets.js';
import { readCampingIndex, writeCampingIndex, readCampingTrips, writeCampingTrips } from '../../../lib/campingState.js';
import { runIndexRefresh } from './index-refresh.js';
import { runMetadataRefresh } from './metadata-refresh.js';
import { runNudgeTick } from './nudge-tick.js';
import { runReleaseTick } from './release-tick.js';
import { sendMessage } from '../../../lib/telegram.js';

const INDEX_PATH = process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json';
const TRIPS_PATH = process.env.CAMPING_TRIPS_PATH ?? '/data/camping-trips.json';

async function main(): Promise<void> {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
                    'GOOGLE_SHEET_ID', 'RECGOV_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  for (const k of required) {
    if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
  }
  const now = new Date();
  console.log(`[camping-cron] tick @ ${formatInTimeZone(now, 'America/Denver', 'yyyy-MM-dd HH:mm zzz')}`);

  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const recgov = createRecGovClient({ apiKey: process.env.RECGOV_API_KEY! });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const sendTelegram = async (text: string) => {
    await sendMessage(
      { botToken: process.env.TELEGRAM_BOT_TOKEN! },
      { chat_id: process.env.TELEGRAM_CHAT_ID!, text, disable_notification: false },
    );
  };

  if (shouldRunIndexRefresh(now)) {
    console.log('[camping-cron] running index-refresh');
    const idx = await readCampingIndex(INDEX_PATH);
    const res = await runIndexRefresh({ existingIndex: idx, client: recgov, sheets, sheetSpreadsheetId: spreadsheetId });
    await writeCampingIndex(INDEX_PATH, res.index);
    console.log(`[camping-cron] index-refresh: +${res.added} new, -${res.deactivated} inactive, ${res.totalActive} active`);
  }

  if (shouldRunMetadataRefresh(now)) {
    console.log('[camping-cron] running metadata-refresh');
    const idx = await readCampingIndex(INDEX_PATH);
    const res = await runMetadataRefresh({ existingIndex: idx, client: recgov });
    await writeCampingIndex(INDEX_PATH, res.index);
    console.log(`[camping-cron] metadata-refresh: ${res.refreshed} updated, ${res.deactivated} deactivated, ${res.failures} failures`);
  }

  if (shouldRunNudgeTick(now)) {
    console.log('[camping-cron] running nudge-tick');
    const idx = await readCampingIndex(INDEX_PATH);
    const trips = await readCampingTrips(TRIPS_PATH);
    const muted = await readMutedFacilityIds(sheets, spreadsheetId);
    const res = await runNudgeTick({ now, index: idx, trips, mutedFacilityIds: muted, sendTelegram });
    await writeCampingTrips(TRIPS_PATH, res.trips);
    console.log(`[camping-cron] nudge-tick: ${res.seasonOpenerFired} season-opener, ${res.sevenDayFired} 7-day`);
  }

  // release-tick always runs; it self-gates.
  const idx = await readCampingIndex(INDEX_PATH);
  const trips = await readCampingTrips(TRIPS_PATH);
  const res = await runReleaseTick({ now, index: idx, trips, sendTelegram });
  if (res.fired > 0) {
    await writeCampingTrips(TRIPS_PATH, res.trips);
    console.log(`[camping-cron] release-tick: fired ${res.fired} alerts`);
  }

  console.log('[camping-cron] tick complete');
}

main().catch((err: unknown) => {
  console.error('[camping-cron] failed:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
