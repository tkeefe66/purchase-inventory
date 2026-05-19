import type { sheets_v4 } from 'googleapis';
import { buildHeaderMap, colLetter } from './sheets.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AssignmentStatus =
  | 'proposed'
  | 'active'
  | 'submitted'
  | 'passed'
  | 'did_not_pass'
  | 'skipped';

export type AssignmentVerdict = 'pass' | 'did_not_pass' | '';

export type ProgressStatus =
  | 'locked'
  | 'available'
  | 'in-progress'
  | 'completed'
  | 'skipped';

export interface AssignmentRow {
  rowIndex: number;
  id: string;
  dateIssued: string;
  dateSubmitted: string;
  dateGraded: string;
  topicId: string;
  assignmentText: string;
  rubricJson: string;
  status: AssignmentStatus;
  submittedPhotoTelegramFileId: string;
  camera: string;
  lens: string;
  settingsExtracted: string;
  aiVerdict: AssignmentVerdict;
  aiCritique: string;
  perCriterionJson: string;
  retryCount: number;
  userNotes: string;
  skippedReason: string;
}

export interface ProgressRow {
  rowIndex: number;
  topicId: string;
  status: ProgressStatus;
  lastActivityAt: string;
  assignmentsPassed: number;
  assignmentsFailed: number;
  theoryLastReadAt: string;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const ASSIGNMENTS_TAB = 'Photography Assignments';
const PROGRESS_TAB = 'Photography Progress';

const ASSIGNMENT_HEADERS = [
  'id',
  'date_issued',
  'date_submitted',
  'date_graded',
  'topic_id',
  'assignment_text',
  'rubric_json',
  'status',
  'submitted_photo_telegram_file_id',
  'camera',
  'lens',
  'settings_extracted',
  'ai_verdict',
  'ai_critique',
  'per_criterion_json',
  'retry_count',
  'user_notes',
  'skipped_reason',
] as const;

const PROGRESS_HEADERS = [
  'topic_id',
  'status',
  'last_activity_at',
  'assignments_passed',
  'assignments_failed',
  'theory_last_read_at',
] as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type RawCell = string | number | boolean | null | undefined;

function str(row: readonly RawCell[], map: ReadonlyMap<string, number>, name: string): string {
  const idx = map.get(name);
  if (idx === undefined) return '';
  const v = row[idx];
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function num(row: readonly RawCell[], map: ReadonlyMap<string, number>, name: string): number {
  const raw = str(row, map, name);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

async function readHeaderRow(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<string[]> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!1:1`,
  });
  return ((resp.data.values?.[0] ?? []) as RawCell[]).map((s) => String(s ?? '').trim());
}

function rowToAssignment(
  raw: readonly RawCell[],
  map: ReadonlyMap<string, number>,
  rowIndex: number,
): AssignmentRow {
  const status = (str(raw, map, 'status') || 'proposed') as AssignmentStatus;
  const aiVerdict = (str(raw, map, 'ai_verdict') || '') as AssignmentVerdict;
  return {
    rowIndex,
    id: str(raw, map, 'id'),
    dateIssued: str(raw, map, 'date_issued'),
    dateSubmitted: str(raw, map, 'date_submitted'),
    dateGraded: str(raw, map, 'date_graded'),
    topicId: str(raw, map, 'topic_id'),
    assignmentText: str(raw, map, 'assignment_text'),
    rubricJson: str(raw, map, 'rubric_json'),
    status,
    submittedPhotoTelegramFileId: str(raw, map, 'submitted_photo_telegram_file_id'),
    camera: str(raw, map, 'camera'),
    lens: str(raw, map, 'lens'),
    settingsExtracted: str(raw, map, 'settings_extracted'),
    aiVerdict,
    aiCritique: str(raw, map, 'ai_critique'),
    perCriterionJson: str(raw, map, 'per_criterion_json'),
    retryCount: num(raw, map, 'retry_count'),
    userNotes: str(raw, map, 'user_notes'),
    skippedReason: str(raw, map, 'skipped_reason'),
  };
}

function rowToProgress(
  raw: readonly RawCell[],
  map: ReadonlyMap<string, number>,
  rowIndex: number,
): ProgressRow {
  const status = (str(raw, map, 'status') || 'locked') as ProgressStatus;
  return {
    rowIndex,
    topicId: str(raw, map, 'topic_id'),
    status,
    lastActivityAt: str(raw, map, 'last_activity_at'),
    assignmentsPassed: num(raw, map, 'assignments_passed'),
    assignmentsFailed: num(raw, map, 'assignments_failed'),
    theoryLastReadAt: str(raw, map, 'theory_last_read_at'),
  };
}

function assignmentToValues(
  row: Omit<AssignmentRow, 'rowIndex'>,
  headerRow: string[],
  map: ReadonlyMap<string, number>,
): Array<string | number> {
  const arr: Array<string | number> = new Array(headerRow.length).fill('');
  const set = (name: string, val: string | number): void => {
    const idx = map.get(name);
    if (idx !== undefined) arr[idx] = val;
  };
  set('id', row.id);
  set('date_issued', row.dateIssued);
  set('date_submitted', row.dateSubmitted);
  set('date_graded', row.dateGraded);
  set('topic_id', row.topicId);
  set('assignment_text', row.assignmentText);
  set('rubric_json', row.rubricJson);
  set('status', row.status);
  set('submitted_photo_telegram_file_id', row.submittedPhotoTelegramFileId);
  set('camera', row.camera);
  set('lens', row.lens);
  set('settings_extracted', row.settingsExtracted);
  set('ai_verdict', row.aiVerdict);
  set('ai_critique', row.aiCritique);
  set('per_criterion_json', row.perCriterionJson);
  set('retry_count', row.retryCount);
  set('user_notes', row.userNotes);
  set('skipped_reason', row.skippedReason);
  return arr;
}

// ---------------------------------------------------------------------------
// Assignment helpers
// ---------------------------------------------------------------------------

export async function readAssignments(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<AssignmentRow[]> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, ASSIGNMENTS_TAB);
  const map = buildHeaderMap(headerRow);
  const lastCol = colLetter(Math.max(headerRow.length - 1, ASSIGNMENT_HEADERS.length - 1));
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${ASSIGNMENTS_TAB}'!A2:${lastCol}`,
  });
  const raw = (resp.data.values ?? []) as RawCell[][];
  return raw
    .map((row, i) => rowToAssignment(row, map, i + 2))
    .filter((r) => r.id !== '');
}

/**
 * The currently-open assignment row, if any. "Open" means anything Tom
 * can still act on: `active` (issued, not yet submitted), `submitted`
 * (mid-grading), or `did_not_pass` (graded as failing but resubmittable
 * per spec). `passed` and `skipped` are terminal — they don't count.
 *
 * If multiple open rows exist (which can happen after old testing data
 * accumulates, or if a previous /start was interrupted), return the most
 * recently issued and log a warning rather than throw — the bot stays
 * usable, and Tom can clean up the sheet at his leisure. The "at most
 * one active|submitted" invariant is still enforced at /start time.
 */
export async function getActiveAssignment(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<AssignmentRow | null> {
  const rows = await readAssignments(sheets, spreadsheetId);
  const open = rows.filter(
    (r) => r.status === 'active' || r.status === 'submitted' || r.status === 'did_not_pass',
  );
  if (open.length === 0) return null;
  if (open.length > 1) {
    const sorted = [...open].sort((a, b) => (b.dateIssued || '').localeCompare(a.dateIssued || ''));
    console.warn(
      `[photographySheets] ${open.length} open assignment rows found (ids: ${open.map((r) => r.id).join(', ')}); returning most recent (${sorted[0]!.id}). Older rows should be marked skipped/passed manually.`,
    );
    return sorted[0]!;
  }
  return open[0]!;
}

export async function appendAssignment(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  row: Omit<AssignmentRow, 'rowIndex'>,
): Promise<number> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, ASSIGNMENTS_TAB);
  const map = buildHeaderMap(headerRow);
  const lastCol = colLetter(headerRow.length - 1);
  const values = assignmentToValues(row, headerRow, map);
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${ASSIGNMENTS_TAB}'!A:${lastCol}`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
  const updatedRange = resp.data.updates?.updatedRange ?? '';
  const m = /![A-Z]+(\d+)/.exec(updatedRange);
  return m ? parseInt(m[1]!, 10) : -1;
}

export async function updateAssignment(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rowIndex: number,
  patch: Partial<Omit<AssignmentRow, 'rowIndex'>>,
): Promise<void> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, ASSIGNMENTS_TAB);
  const map = buildHeaderMap(headerRow);

  const FIELD_TO_HEADER: ReadonlyMap<keyof Omit<AssignmentRow, 'rowIndex'>, string> = new Map([
    ['id', 'id'],
    ['dateIssued', 'date_issued'],
    ['dateSubmitted', 'date_submitted'],
    ['dateGraded', 'date_graded'],
    ['topicId', 'topic_id'],
    ['assignmentText', 'assignment_text'],
    ['rubricJson', 'rubric_json'],
    ['status', 'status'],
    ['submittedPhotoTelegramFileId', 'submitted_photo_telegram_file_id'],
    ['camera', 'camera'],
    ['lens', 'lens'],
    ['settingsExtracted', 'settings_extracted'],
    ['aiVerdict', 'ai_verdict'],
    ['aiCritique', 'ai_critique'],
    ['perCriterionJson', 'per_criterion_json'],
    ['retryCount', 'retry_count'],
    ['userNotes', 'user_notes'],
    ['skippedReason', 'skipped_reason'],
  ]);

  const data: Array<{ range: string; values: Array<Array<string | number>> }> = [];
  for (const [field, header] of FIELD_TO_HEADER) {
    const value = patch[field];
    if (value === undefined) continue;
    const col = map.get(header);
    if (col === undefined) continue;
    data.push({
      range: `'${ASSIGNMENTS_TAB}'!${colLetter(col)}${rowIndex}`,
      values: [[value as string | number]],
    });
  }
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });
}

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------

export async function readProgress(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
): Promise<ProgressRow[]> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, PROGRESS_TAB);
  const map = buildHeaderMap(headerRow);
  const lastCol = colLetter(Math.max(headerRow.length - 1, PROGRESS_HEADERS.length - 1));
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${PROGRESS_TAB}'!A2:${lastCol}`,
  });
  const raw = (resp.data.values ?? []) as RawCell[][];
  return raw
    .map((row, i) => rowToProgress(row, map, i + 2))
    .filter((r) => r.topicId !== '');
}

export async function upsertProgress(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  topicId: string,
  patch: Partial<Omit<ProgressRow, 'rowIndex' | 'topicId'>>,
): Promise<void> {
  const headerRow = await readHeaderRow(sheets, spreadsheetId, PROGRESS_TAB);
  const map = buildHeaderMap(headerRow);
  const lastCol = colLetter(Math.max(headerRow.length - 1, PROGRESS_HEADERS.length - 1));

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${PROGRESS_TAB}'!A2:${lastCol}`,
  });
  const raw = (resp.data.values ?? []) as RawCell[][];
  const topicColIdx = map.get('topic_id') ?? 0;
  const existingRowIndex = raw.findIndex(
    (row) => String(row[topicColIdx] ?? '').trim() === topicId,
  );

  if (existingRowIndex >= 0) {
    // Update existing row
    const sheetRowIndex = existingRowIndex + 2;
    const FIELD_TO_HEADER: ReadonlyMap<keyof Omit<ProgressRow, 'rowIndex' | 'topicId'>, string> =
      new Map([
        ['status', 'status'],
        ['lastActivityAt', 'last_activity_at'],
        ['assignmentsPassed', 'assignments_passed'],
        ['assignmentsFailed', 'assignments_failed'],
        ['theoryLastReadAt', 'theory_last_read_at'],
      ]);

    const data: Array<{ range: string; values: Array<Array<string | number>> }> = [];
    for (const [field, header] of FIELD_TO_HEADER) {
      const value = patch[field];
      if (value === undefined) continue;
      const col = map.get(header);
      if (col === undefined) continue;
      data.push({
        range: `'${PROGRESS_TAB}'!${colLetter(col)}${sheetRowIndex}`,
        values: [[value as string | number]],
      });
    }
    if (data.length === 0) return;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
  } else {
    // Append new row with defaults + patch
    const arr: Array<string | number> = new Array(headerRow.length).fill('');
    const set = (name: string, val: string | number): void => {
      const idx = map.get(name);
      if (idx !== undefined) arr[idx] = val;
    };
    set('topic_id', topicId);
    set('status', patch.status ?? 'locked');
    set('last_activity_at', patch.lastActivityAt ?? '');
    set('assignments_passed', patch.assignmentsPassed ?? 0);
    set('assignments_failed', patch.assignmentsFailed ?? 0);
    set('theory_last_read_at', patch.theoryLastReadAt ?? '');

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${PROGRESS_TAB}'!A:${lastCol}`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [arr] },
    });
  }
}
