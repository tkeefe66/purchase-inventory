import 'dotenv/config';
import { createSheetsClient } from '../lib/sheets.js';
import { runSheetBackup } from '../lib/sheetBackup.js';
import { formatInTimeZone } from 'date-fns-tz';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const cfg = {
    clientId: req('GOOGLE_CLIENT_ID'),
    clientSecret: req('GOOGLE_CLIENT_SECRET'),
    refreshToken: req('GOOGLE_REFRESH_TOKEN'),
  };
  const spreadsheetId = req('GOOGLE_SHEET_ID');
  const root = process.env['SHEET_BACKUP_ROOT'] ?? './local-data';
  const keepDays = Number(process.env['SHEET_BACKUP_KEEP_DAYS'] ?? '30');
  const now = new Date();
  const dateStamp = formatInTimeZone(now, 'America/Denver', 'yyyy-MM-dd');
  const sheets = createSheetsClient(cfg);
  const res = await runSheetBackup(sheets, spreadsheetId, {
    root, keepDays, takenAtIso: now.toISOString(), dateStamp,
  });
  console.log(`Backup written: ${res.path}${res.deleted.length ? ` (pruned ${res.deleted.length})` : ''}`);
}

main().catch((err) => { console.error('[backup-sheet]', err instanceof Error ? err.message : err); process.exit(1); });
