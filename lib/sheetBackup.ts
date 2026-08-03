import { mkdir, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { SheetsClient } from './sheets.js';

export type SheetBackup = {
  takenAt: string;
  spreadsheetId: string;
  tabs: Record<string, string[][]>;
};

export async function backupAllTabs(
  sheets: SheetsClient,
  spreadsheetId: string,
  takenAtIso: string,
): Promise<SheetBackup> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = (meta.data.sheets ?? [])
    .map((s: { properties?: { title?: string | null } }) => s.properties?.title)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);

  const tabs: Record<string, string[][]> = {};
  for (const title of titles) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${title}'`,
    });
    tabs[title] = (res.data.values ?? []) as string[][];
  }
  return { takenAt: takenAtIso, spreadsheetId, tabs };
}

export async function writeBackup(
  root: string,
  backup: SheetBackup,
  dateStamp: string,
): Promise<string> {
  const dir = join(root, 'backups');
  await mkdir(dir, { recursive: true });
  const finalPath = join(dir, `sheet-${dateStamp}.json`);
  const tmp = `${finalPath}.tmp`;
  await writeFile(tmp, JSON.stringify(backup, null, 2), 'utf-8');
  await rename(tmp, finalPath);
  return finalPath;
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  return Math.round((db - da) / 86_400_000);
}

export async function pruneBackups(
  root: string,
  keepDays: number,
  todayStamp: string,
): Promise<string[]> {
  const dir = join(root, 'backups');
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const deleted: string[] = [];
  for (const name of names) {
    const m = name.match(/^sheet-(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    if (daysBetween(m[1]!, todayStamp) > keepDays) {
      await unlink(join(dir, name));
      deleted.push(name);
    }
  }
  return deleted;
}
