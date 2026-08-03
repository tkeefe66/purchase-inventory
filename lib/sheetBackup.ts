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
