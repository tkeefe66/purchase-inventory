# Trash-aware hourly cron + 7pm daily digest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cron scans Trash + Inbox + archive hourly, only sends a Telegram digest once a day at 7pm Mountain, and alerts immediately on errors. Backfills missed emails since 2026-04-30 on demand.

**Architecture:** Pipeline becomes side-effect-pure (returns `PipelineResult`). `apps/cron/index.ts` owns persistence (new "Cron Log" sheet tab) and Telegram. Conditional send: errors → immediate, 19:00 MT → daily summary aggregated from Cron Log, else silent. Bot's `/scan` continues to call `runPipeline` directly and formats its own reply.

**Tech Stack:** Node 20 + TypeScript, vitest, googleapis (Sheets v4), `@anthropic-ai/sdk`, date-fns-tz, Railway cron.

**Spec:** `docs/superpowers/specs/2026-05-15-trash-aware-hourly-cron-design.md`

---

## Task 1: Add `in:anywhere` to the Gmail query

**Files:**
- Modify: `apps/cron/pipeline.ts` (export `buildQuery`, add `in:anywhere`)
- Create: `tests/cron/buildQuery.test.ts`

- [ ] **Step 1: Export `buildQuery` from `pipeline.ts` so tests can import it**

In `apps/cron/pipeline.ts`, change the `function buildQuery` declaration to be exported.

```ts
export function buildQuery(opts: PipelineOptions): string {
```

- [ ] **Step 2: Write the failing test**

Create `tests/cron/buildQuery.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { buildQuery } from '../../apps/cron/pipeline.js';

const baseOpts = {
  dryRun: false,
  reprocessSince: undefined,
  maxMessages: undefined,
  ingestAfterDate: undefined,
  spreadsheetId: 'X',
  clientId: 'X', clientSecret: 'X', refreshToken: 'X',
  anthropicKey: 'X',
  telegramBotToken: undefined, telegramChatId: undefined,
};

describe('buildQuery', () => {
  test('includes in:anywhere so Gmail searches Trash + archive too', () => {
    const q = buildQuery(baseOpts);
    expect(q).toContain('in:anywhere');
  });

  test('default (no ingestAfterDate, no reprocess) uses newer_than:30d', () => {
    const q = buildQuery(baseOpts);
    expect(q).toContain('newer_than:30d');
    expect(q).toContain('-label:inventory-processed');
  });

  test('reprocess mode bypasses the label filter', () => {
    const q = buildQuery({ ...baseOpts, reprocessSince: '2026-04-30' });
    expect(q).not.toContain('-label:inventory-processed');
    expect(q).toContain('after:2026/04/30');
    expect(q).toContain('in:anywhere');
  });

  test('ingestAfterDate replaces newer_than', () => {
    const q = buildQuery({ ...baseOpts, ingestAfterDate: '2026-04-01' });
    expect(q).toContain('after:2026/04/01');
    expect(q).not.toContain('newer_than:30d');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/cron/buildQuery.test.ts`
Expected: the `in:anywhere` test FAILS (other three pass — the operator isn't there yet).

- [ ] **Step 4: Add `in:anywhere` to all branches of `buildQuery`**

In `apps/cron/pipeline.ts`:

```ts
export function buildQuery(opts: PipelineOptions): string {
  const senders = `from:(${KNOWN_SENDERS.map((s) => s.email).join(' OR ')})`;
  if (opts.reprocessSince) {
    return `${senders} in:anywhere after:${gmailDate(opts.reprocessSince)}`;
  }
  const afterPart = opts.ingestAfterDate
    ? ` after:${gmailDate(opts.ingestAfterDate)}`
    : ' newer_than:30d';
  return `${senders} in:anywhere -label:${PROCESSED_LABEL}${afterPart}`;
}
```

- [ ] **Step 5: Run tests + full suite to confirm**

Run: `npx vitest run tests/cron/buildQuery.test.ts && npx vitest run`
Expected: all 4 buildQuery tests PASS; full suite still green.

- [ ] **Step 6: Commit**

```bash
git add apps/cron/pipeline.ts tests/cron/buildQuery.test.ts
git commit -m "feat(cron): include Trash in Gmail query via in:anywhere"
```

---

## Task 2: `CronLogRow` type + `appendCronLogRow` with auto-create

**Files:**
- Modify: `lib/sheets.ts`
- Create: `tests/lib/cronLog.test.ts`

- [ ] **Step 1: Write the failing test for `appendCronLogRow`**

Create `tests/lib/cronLog.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { appendCronLogRow, type CronLogRow } from '../../lib/sheets.js';

function makeSheetsMock(opts: {
  existingTabs: string[];
  existingHeader?: (string | null)[];
}) {
  const created: string[] = [];
  const appended: { range: string; values: unknown[][] }[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) },
      }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) {
          created.push(r.addSheet.properties.title);
        }
        return { data: {} };
      }),
      values: {
        get: vi.fn().mockResolvedValue({
          data: { values: opts.existingHeader ? [opts.existingHeader] : [] },
        }),
        append: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          appended.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        update: vi.fn().mockResolvedValue({ data: {} }),
      },
    },
  };
  return { sheets, created, appended };
}

const sampleRow: CronLogRow = {
  runTimestamp: '2026-05-15T13:00:00.000Z',
  itemsAdded: 2,
  itemsBySource: { Amazon: 2 },
  itemsByDomain: { Outdoor: 2 },
  returnsApplied: 0,
  messagesScanned: 5,
  errorsCount: 0,
  durationSeconds: 8.3,
};

describe('appendCronLogRow', () => {
  test('creates "Cron Log" tab on first write when missing', async () => {
    const { sheets, created } = makeSheetsMock({ existingTabs: ['All Purchases'] });
    await appendCronLogRow(sheets as never, 'sheet-id', sampleRow);
    expect(created).toContain('Cron Log');
  });

  test('appends a row with JSON-stringified maps', async () => {
    const header = ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                    'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'];
    const { sheets, appended } = makeSheetsMock({
      existingTabs: ['All Purchases', 'Cron Log'],
      existingHeader: header,
    });
    await appendCronLogRow(sheets as never, 'sheet-id', sampleRow);
    expect(appended).toHaveLength(1);
    const row = appended[0]!.values[0]!;
    expect(row[0]).toBe('2026-05-15T13:00:00.000Z');
    expect(row[1]).toBe(2);
    expect(row[2]).toBe('{"Amazon":2}');
    expect(row[3]).toBe('{"Outdoor":2}');
  });

  test('does not re-create the tab when it already exists', async () => {
    const { sheets, created } = makeSheetsMock({
      existingTabs: ['All Purchases', 'Cron Log'],
      existingHeader: ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                       'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'],
    });
    await appendCronLogRow(sheets as never, 'sheet-id', sampleRow);
    expect(created).not.toContain('Cron Log');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cronLog.test.ts`
Expected: FAIL with "appendCronLogRow is not exported" / similar.

- [ ] **Step 3: Add `CronLogRow` type and constants near the bottom of `lib/sheets.ts`**

```ts
const CRON_LOG_TAB = 'Cron Log';
const CRON_LOG_HEADER = [
  'Run Timestamp',
  'Items Added',
  'Items By Source',
  'Items By Domain',
  'Returns Applied',
  'Messages Scanned',
  'Errors Count',
  'Duration (s)',
] as const;

export interface CronLogRow {
  runTimestamp: string;
  itemsAdded: number;
  itemsBySource: Record<string, number>;
  itemsByDomain: Record<string, number>;
  returnsApplied: number;
  messagesScanned: number;
  errorsCount: number;
  durationSeconds: number;
}
```

- [ ] **Step 4: Add a private `ensureCronLogTab` helper**

```ts
async function ensureCronLogTab(sheets: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === CRON_LOG_TAB,
  );
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: CRON_LOG_TAB } } }],
    },
  });
  // Write the header row.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${CRON_LOG_TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [Array.from(CRON_LOG_HEADER)] },
  });
}
```

- [ ] **Step 5: Add the `appendCronLogRow` function**

```ts
export async function appendCronLogRow(
  sheets: SheetsClient,
  spreadsheetId: string,
  row: CronLogRow,
): Promise<void> {
  await ensureCronLogTab(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${CRON_LOG_TAB}'!A:H`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        row.runTimestamp,
        row.itemsAdded,
        JSON.stringify(row.itemsBySource),
        JSON.stringify(row.itemsByDomain),
        row.returnsApplied,
        row.messagesScanned,
        row.errorsCount,
        row.durationSeconds,
      ]],
    },
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cronLog.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/sheets.ts tests/lib/cronLog.test.ts
git commit -m "feat(sheets): CronLogRow type + appendCronLogRow with auto-create"
```

---

## Task 3: `readCronLogToday`

**Files:**
- Modify: `lib/sheets.ts`
- Modify: `tests/lib/cronLog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/cronLog.test.ts`:

```ts
import { readCronLogToday } from '../../lib/sheets.js';

describe('readCronLogToday', () => {
  function makeReader(rows: (string | number)[][]) {
    const header = ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                    'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'];
    return {
      spreadsheets: {
        values: {
          get: vi.fn().mockResolvedValue({ data: { values: [header, ...rows] } }),
        },
      },
    };
  }

  test('returns only rows whose Run Timestamp falls on the requested MT date', async () => {
    // 2026-05-15 in Mountain time (UTC-6 in DST). 13:00 UTC = 07:00 MT, 06:00 UTC = 00:00 MT.
    const rows = [
      ['2026-05-15T07:00:00.000Z', 1, '{"Amazon":1}', '{"Outdoor":1}', 0, 3, 0, 5.0], // 01:00 MT 5/15
      ['2026-05-15T13:00:00.000Z', 2, '{"Amazon":2}', '{"Outdoor":2}', 0, 5, 0, 8.3], // 07:00 MT 5/15
      ['2026-05-14T23:00:00.000Z', 1, '{"REI":1}', '{"Outdoor":1}', 0, 2, 0, 4.1],    // 17:00 MT 5/14
      ['2026-05-16T02:00:00.000Z', 1, '{"Amazon":1}', '{"Home":1}', 0, 1, 0, 2.0],    // 20:00 MT 5/15
    ];
    const sheets = makeReader(rows);
    const today = await readCronLogToday(sheets as never, 'sheet-id', '2026-05-15');
    expect(today).toHaveLength(3); // first, second, fourth rows
    expect(today[0]!.itemsAdded).toBe(1);
    expect(today[1]!.itemsBySource).toEqual({ Amazon: 2 });
  });

  test('returns [] when the tab is empty / header-only', async () => {
    const sheets = makeReader([]);
    expect(await readCronLogToday(sheets as never, 'sheet-id', '2026-05-15')).toEqual([]);
  });

  test('returns [] when the Cron Log tab does not exist (404 from values.get)', async () => {
    const sheets = {
      spreadsheets: {
        values: {
          get: vi.fn().mockRejectedValue({ code: 400, message: 'Unable to parse range' }),
        },
      },
    };
    expect(await readCronLogToday(sheets as never, 'sheet-id', '2026-05-15')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/cronLog.test.ts`
Expected: FAIL "readCronLogToday is not exported".

- [ ] **Step 3: Implement in `lib/sheets.ts`**

Add (importing `formatInTimeZone` from `date-fns-tz` at the top if not already imported):

```ts
import { formatInTimeZone } from 'date-fns-tz';

export async function readCronLogToday(
  sheets: SheetsClient,
  spreadsheetId: string,
  todayMt: string,  // 'YYYY-MM-DD' in Mountain time
): Promise<CronLogRow[]> {
  let raw: (string | number)[][];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${CRON_LOG_TAB}'!A:H`,
    });
    raw = (resp.data.values ?? []) as (string | number)[][];
  } catch {
    return []; // Tab probably doesn't exist yet.
  }
  if (raw.length < 2) return [];

  const out: CronLogRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i]!;
    const tsRaw = String(r[0] ?? '');
    if (!tsRaw) continue;
    const ts = new Date(tsRaw);
    if (Number.isNaN(ts.getTime())) continue;
    const tsMtDate = formatInTimeZone(ts, 'America/Denver', 'yyyy-MM-dd');
    if (tsMtDate !== todayMt) continue;
    out.push({
      runTimestamp: tsRaw,
      itemsAdded: Number(r[1] ?? 0),
      itemsBySource: safeJson(String(r[2] ?? '{}')),
      itemsByDomain: safeJson(String(r[3] ?? '{}')),
      returnsApplied: Number(r[4] ?? 0),
      messagesScanned: Number(r[5] ?? 0),
      errorsCount: Number(r[6] ?? 0),
      durationSeconds: Number(r[7] ?? 0),
    });
  }
  return out;
}

function safeJson(s: string): Record<string, number> {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/cronLog.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.ts tests/lib/cronLog.test.ts
git commit -m "feat(sheets): readCronLogToday filters Cron Log rows to a given MT date"
```

---

## Task 4: `pruneCronLog`

**Files:**
- Modify: `lib/sheets.ts`
- Modify: `tests/lib/cronLog.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/lib/cronLog.test.ts`:

```ts
import { pruneCronLog } from '../../lib/sheets.js';

describe('pruneCronLog', () => {
  function makePrunerSheets(rows: (string | number)[][]) {
    const header = ['Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
                    'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)'];
    const deleteRequests: { startIndex: number; endIndex: number }[] = [];
    const sheets = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: { sheets: [{ properties: { title: 'Cron Log', sheetId: 42 } }] },
        }),
        values: {
          get: vi.fn().mockResolvedValue({ data: { values: [header, ...rows] } }),
        },
        batchUpdate: vi.fn(async (req: { requestBody: { requests: { deleteDimension: { range: { startIndex: number; endIndex: number } } }[] } }) => {
          for (const r of req.requestBody.requests) {
            deleteRequests.push(r.deleteDimension.range);
          }
          return { data: {} };
        }),
      },
    };
    return { sheets, deleteRequests };
  }

  test('deletes rows older than the threshold; keeps recent rows', async () => {
    // "now" inside the test: pretend it's 2026-05-15T12:00:00Z. 30-day cutoff = 2026-04-15.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const rows = [
      ['2026-04-10T10:00:00.000Z', 1, '{}', '{}', 0, 1, 0, 1], // old → delete
      ['2026-04-20T10:00:00.000Z', 1, '{}', '{}', 0, 1, 0, 1], // recent → keep
      ['2026-04-01T10:00:00.000Z', 1, '{}', '{}', 0, 1, 0, 1], // old → delete
    ];
    const { sheets, deleteRequests } = makePrunerSheets(rows);
    const result = await pruneCronLog(sheets as never, 'sheet-id', 30);
    expect(result.deleted).toBe(2);
    // Two delete requests, descending by row index so earlier deletes don't shift later ones.
    expect(deleteRequests.length).toBe(2);
    vi.useRealTimers();
  });

  test('no-op when nothing is old enough', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
    const rows = [
      ['2026-05-10T10:00:00.000Z', 1, '{}', '{}', 0, 1, 0, 1],
      ['2026-05-12T10:00:00.000Z', 1, '{}', '{}', 0, 1, 0, 1],
    ];
    const { sheets, deleteRequests } = makePrunerSheets(rows);
    const result = await pruneCronLog(sheets as never, 'sheet-id', 30);
    expect(result.deleted).toBe(0);
    expect(deleteRequests).toEqual([]);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/lib/cronLog.test.ts`
Expected: FAIL "pruneCronLog is not exported".

- [ ] **Step 3: Implement in `lib/sheets.ts`**

```ts
export async function pruneCronLog(
  sheets: SheetsClient,
  spreadsheetId: string,
  olderThanDays: number,
): Promise<{ deleted: number }> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = (meta.data.sheets ?? []).find((s) => s.properties?.title === CRON_LOG_TAB);
  if (!tab?.properties?.sheetId) return { deleted: 0 };
  const sheetId = tab.properties.sheetId;

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${CRON_LOG_TAB}'!A:H`,
  });
  const rows = (resp.data.values ?? []) as (string | number)[][];
  if (rows.length < 2) return { deleted: 0 };

  const cutoff = Date.now() - olderThanDays * 86400 * 1000;
  // Identify row indices (in the sheet, 1-based; data rows start at 2) to delete.
  const toDelete: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const ts = new Date(String(rows[i]![0] ?? ''));
    if (Number.isNaN(ts.getTime())) continue;
    if (ts.getTime() < cutoff) toDelete.push(i); // 0-based offset into rows array
  }
  if (toDelete.length === 0) return { deleted: 0 };

  // batchUpdate requires deleteDimension requests in DESCENDING index order so
  // earlier deletes don't shift the indices of later ones. Convert array index
  // i → grid row index i (the sheets API uses 0-based row indices including header).
  toDelete.sort((a, b) => b - a);
  const requests = toDelete.map((i) => ({
    deleteDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 },
    },
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
  return { deleted: toDelete.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/cronLog.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/sheets.ts tests/lib/cronLog.test.ts
git commit -m "feat(sheets): pruneCronLog deletes rows older than N days"
```

---

## Task 5: Remove the Telegram send block from `runPipeline` (pipeline becomes pure)

**Files:**
- Modify: `apps/cron/pipeline.ts`

- [ ] **Step 1: Identify the block to remove**

Open `apps/cron/pipeline.ts`. Locate the block that starts with `// Telegram digest` (or `if (opts.telegramBotToken && opts.telegramChatId)`) — that's the entire if-block that calls `sendMessage`. It's near the end of `runPipeline`.

- [ ] **Step 2: Remove the block**

Delete from the `// Telegram digest` comment (or its equivalent) through the closing brace of the `if` statement. The pipeline now ends with `return result;` directly after `result.endedAt = new Date().toISOString();`.

You can also remove `formatDigest()` itself — it's no longer referenced by the pipeline. (We'll reintroduce a digest formatter in Task 6 that operates on Cron Log rows instead of a single `PipelineResult`.) Also delete the import of `sendMessage` from `lib/telegram` at the top of the file if nothing else in the file uses it.

- [ ] **Step 3: Run the full suite to confirm nothing depended on the digest**

Run: `npx vitest run`
Expected: all tests PASS. (If any test referenced `formatDigest` directly, delete or update it.)

- [ ] **Step 4: Run cron:dry to confirm the pipeline still works end-to-end**

Run: `npm run cron:dry -- --max=5`
Expected: completes with `dryRun: true` in the result, no Telegram message attempted.

- [ ] **Step 5: Commit**

```bash
git add apps/cron/pipeline.ts
git commit -m "refactor(pipeline): drop built-in Telegram send; runPipeline returns only PipelineResult"
```

---

## Task 6: `formatDailySummary(rows)` helper

**Files:**
- Create: `apps/cron/digest.ts`
- Create: `tests/cron/digest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cron/digest.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { formatDailySummary, formatErrorAlert } from '../../apps/cron/digest.js';
import type { CronLogRow } from '../../lib/sheets.js';

const r = (overrides: Partial<CronLogRow>): CronLogRow => ({
  runTimestamp: '2026-05-15T13:00:00.000Z',
  itemsAdded: 0,
  itemsBySource: {},
  itemsByDomain: {},
  returnsApplied: 0,
  messagesScanned: 0,
  errorsCount: 0,
  durationSeconds: 0,
  ...overrides,
});

describe('formatDailySummary', () => {
  test('no-activity day prints a clear "nothing to report" message', () => {
    const out = formatDailySummary([
      r({ messagesScanned: 1, durationSeconds: 3 }),
      r({ messagesScanned: 0, durationSeconds: 2 }),
    ], 24);
    expect(out).toMatch(/Daily inventory summary/i);
    expect(out).toMatch(/No new items/i);
    expect(out).toMatch(/24 runs/);
  });

  test('aggregates items by source and domain across runs', () => {
    const out = formatDailySummary([
      r({ itemsAdded: 2, itemsBySource: { Amazon: 2 }, itemsByDomain: { Outdoor: 2 } }),
      r({ itemsAdded: 1, itemsBySource: { REI: 1 }, itemsByDomain: { Outdoor: 1 } }),
      r({ returnsApplied: 1 }),
    ], 24);
    expect(out).toMatch(/3 new items/);
    expect(out).toMatch(/Amazon: 2/);
    expect(out).toMatch(/REI: 1/);
    expect(out).toMatch(/Outdoor: 3/);
    expect(out).toMatch(/1 return/);
  });

  test('reports run count even when log is empty (cron ran but log read failed)', () => {
    const out = formatDailySummary([], 24);
    expect(out).toMatch(/24 runs/);
    expect(out).toMatch(/No new items/i);
  });
});

describe('formatErrorAlert', () => {
  test('lists each error with its message id and subject', () => {
    const out = formatErrorAlert({
      startedAt: '', endedAt: '',
      messagesScanned: 3, itemsAdded: 0,
      itemsBySource: {}, itemsByDomain: {},
      skippedNonReceipts: 1, duplicatesIgnored: 0,
      labelsApplied: 0, returnsApplied: 0, returnsUnmatched: 0,
      errors: [
        { messageId: 'abc123', subject: 'Ordered: foo', error: 'JSON parse failed' },
        { messageId: 'def456', subject: 'Shipped: bar', error: '529 overloaded' },
      ],
      dryRun: false,
    });
    expect(out).toMatch(/Inventory cron error/i);
    expect(out).toMatch(/2 error/);
    expect(out).toContain('Ordered: foo');
    expect(out).toContain('Shipped: bar');
    expect(out).toContain('JSON parse failed');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/cron/digest.test.ts`
Expected: FAIL "Cannot find module ../../apps/cron/digest.js".

- [ ] **Step 3: Create `apps/cron/digest.ts`**

```ts
import { formatInTimeZone } from 'date-fns-tz';
import type { CronLogRow } from '../../lib/sheets.js';
import type { PipelineResult } from './pipeline.js';

const TZ = 'America/Denver';

/**
 * Aggregate today's Cron Log rows into the audible 7pm Mountain digest.
 * `totalRunsToday` is the count Telegram should reflect (e.g., 24 hourly
 * runs); it's passed explicitly so even a log-read failure produces a
 * useful "we ran N times" message.
 */
export function formatDailySummary(rows: readonly CronLogRow[], totalRunsToday: number): string {
  const totals = {
    itemsAdded: 0,
    returnsApplied: 0,
    messagesScanned: 0,
    errorsCount: 0,
    bySource: {} as Record<string, number>,
    byDomain: {} as Record<string, number>,
  };
  for (const r of rows) {
    totals.itemsAdded += r.itemsAdded;
    totals.returnsApplied += r.returnsApplied;
    totals.messagesScanned += r.messagesScanned;
    totals.errorsCount += r.errorsCount;
    for (const [k, v] of Object.entries(r.itemsBySource)) totals.bySource[k] = (totals.bySource[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.itemsByDomain)) totals.byDomain[k] = (totals.byDomain[k] ?? 0) + v;
  }

  const when = formatInTimeZone(new Date(), TZ, 'EEE MMM d');
  const lines: string[] = [`Daily inventory summary — ${when}`];

  if (totals.itemsAdded > 0) {
    lines.push(`✅ ${totals.itemsAdded} new item${totals.itemsAdded === 1 ? '' : 's'}`);
    const bySource = Object.entries(totals.bySource).map(([k, v]) => `${k}: ${v}`).join(', ');
    if (bySource) lines.push(`   ${bySource}`);
    const byDomain = Object.entries(totals.byDomain)
      .sort(([, a], [, b]) => b - a)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    if (byDomain) lines.push(`   Domains: ${byDomain}`);
  } else {
    lines.push(`📭 No new items today`);
  }

  if (totals.returnsApplied > 0) {
    lines.push(`↩️ ${totals.returnsApplied} return${totals.returnsApplied === 1 ? '' : 's'} applied`);
  }

  lines.push(
    `${totalRunsToday} runs, ${totals.messagesScanned} email${totals.messagesScanned === 1 ? '' : 's'} scanned`,
  );

  if (totals.errorsCount > 0) {
    lines.push(`(${totals.errorsCount} run${totals.errorsCount === 1 ? '' : 's'} had errors — alerted separately)`);
  }

  return lines.join('\n');
}

/**
 * Format an immediate audible alert when a single cron run hit errors.
 * Includes up to 5 errored messages; the rest are summarized.
 */
export function formatErrorAlert(result: PipelineResult): string {
  const lines: string[] = [];
  const when = formatInTimeZone(new Date(result.startedAt || new Date()), TZ, 'EEE MMM d h:mm a zzz');
  lines.push(`❌ Inventory cron error @ ${when}`);
  lines.push(`${result.errors.length} error${result.errors.length === 1 ? '' : 's'} on this run:`);
  for (const e of result.errors.slice(0, 5)) {
    lines.push(`   • ${e.subject.slice(0, 60)} — ${e.error.slice(0, 120)}`);
  }
  if (result.errors.length > 5) {
    lines.push(`   …and ${result.errors.length - 5} more`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/cron/digest.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cron/digest.ts tests/cron/digest.test.ts
git commit -m "feat(cron): formatDailySummary + formatErrorAlert digest helpers"
```

---

## Task 7: `shouldSendDailyDigestAt` hour-gate helper

**Files:**
- Modify: `apps/cron/digest.ts`
- Create: `tests/cron/shouldSendDailyDigestAt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cron/shouldSendDailyDigestAt.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { shouldSendDailyDigestAt } from '../../apps/cron/digest.js';

describe('shouldSendDailyDigestAt', () => {
  test('returns true at 19:00 Mountain (during DST = 01:00 UTC)', () => {
    // 2026-05-16 01:00 UTC === 2026-05-15 19:00 MT (MDT, UTC-6).
    expect(shouldSendDailyDigestAt(new Date('2026-05-16T01:00:00Z'))).toBe(true);
  });

  test('returns true at 19:00 Mountain in standard time (= 02:00 UTC)', () => {
    // 2026-01-16 02:00 UTC === 2026-01-15 19:00 MT (MST, UTC-7).
    expect(shouldSendDailyDigestAt(new Date('2026-01-16T02:00:00Z'))).toBe(true);
  });

  test('returns false at other hours', () => {
    expect(shouldSendDailyDigestAt(new Date('2026-05-16T00:00:00Z'))).toBe(false); // 18:00 MT
    expect(shouldSendDailyDigestAt(new Date('2026-05-16T02:00:00Z'))).toBe(false); // 20:00 MT
    expect(shouldSendDailyDigestAt(new Date('2026-05-15T12:00:00Z'))).toBe(false); // 06:00 MT
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run tests/cron/shouldSendDailyDigestAt.test.ts`
Expected: FAIL "shouldSendDailyDigestAt is not exported".

- [ ] **Step 3: Add the helper to `apps/cron/digest.ts`**

Append:

```ts
/**
 * Returns true if `now` falls within the 19:00 (7pm) hour in Mountain time.
 * DST-aware via date-fns-tz.
 */
export function shouldSendDailyDigestAt(now: Date): boolean {
  const hour = Number(formatInTimeZone(now, TZ, 'H'));
  return hour === 19;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/cron/shouldSendDailyDigestAt.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cron/digest.ts tests/cron/shouldSendDailyDigestAt.test.ts
git commit -m "feat(cron): shouldSendDailyDigestAt hour-gate for 7pm MT digest"
```

---

## Task 8: Wire Cron Log + conditional send into `apps/cron/index.ts`

**Files:**
- Modify: `apps/cron/index.ts`

- [ ] **Step 1: Read the current `apps/cron/index.ts` to understand the main() flow**

Run: `cat apps/cron/index.ts` (or open in editor). Identify where `runPipeline(opts)` is called and what happens after.

- [ ] **Step 2: Add imports**

Near the top of `apps/cron/index.ts`:

```ts
import { google } from 'googleapis';
import { appendCronLogRow, readCronLogToday, pruneCronLog, createSheetsClient } from '../../lib/sheets.js';
import { formatDailySummary, formatErrorAlert, shouldSendDailyDigestAt } from './digest.js';
import { sendMessage } from '../../lib/telegram.js';
import { formatInTimeZone } from 'date-fns-tz';
```

(Drop any of these that are already imported.)

- [ ] **Step 3: After `await runPipeline(opts)`, replace the existing post-run handling**

Replace the block that follows `const result = await runPipeline(opts);` (and any console.log of the result) with:

```ts
const result = await runPipeline(opts);
console.log('\n=== Result ===');
console.log(JSON.stringify(result, null, 2));

// Persist this run to the Cron Log tab.
const sheets = createSheetsClient({
  clientId: env.clientId,
  clientSecret: env.clientSecret,
  refreshToken: env.refreshToken,
});
const durationS = (new Date(result.endedAt).getTime() - new Date(result.startedAt).getTime()) / 1000;
try {
  await appendCronLogRow(sheets, env.spreadsheetId, {
    runTimestamp: result.startedAt,
    itemsAdded: result.itemsAdded,
    itemsBySource: result.itemsBySource,
    itemsByDomain: result.itemsByDomain,
    returnsApplied: result.returnsApplied,
    messagesScanned: result.messagesScanned,
    errorsCount: result.errors.length,
    durationSeconds: Number(durationS.toFixed(2)),
  });
  // Best-effort prune; failures here don't block the digest.
  try { await pruneCronLog(sheets, env.spreadsheetId, 30); } catch (err) {
    console.warn('[cron] pruneCronLog failed:', err instanceof Error ? err.message : err);
  }
} catch (err) {
  console.warn('[cron] appendCronLogRow failed:', err instanceof Error ? err.message : err);
}

// Conditional Telegram send.
const tgEnabled = env.telegramBotToken && env.telegramChatId;
if (tgEnabled && result.errors.length > 0) {
  try {
    await sendMessage(
      { botToken: env.telegramBotToken! },
      {
        chat_id: env.telegramChatId!,
        text: formatErrorAlert(result),
        disable_notification: false,
      },
    );
  } catch (err) {
    console.warn('[cron] error-alert send failed:', err instanceof Error ? err.message : err);
  }
} else if (tgEnabled && shouldSendDailyDigestAt(new Date())) {
  const todayMt = formatInTimeZone(new Date(), 'America/Denver', 'yyyy-MM-dd');
  let logRows: Awaited<ReturnType<typeof readCronLogToday>> = [];
  try { logRows = await readCronLogToday(sheets, env.spreadsheetId, todayMt); }
  catch (err) { console.warn('[cron] readCronLogToday failed:', err instanceof Error ? err.message : err); }
  try {
    await sendMessage(
      { botToken: env.telegramBotToken! },
      {
        chat_id: env.telegramChatId!,
        text: formatDailySummary(logRows, logRows.length),
        disable_notification: false,
      },
    );
  } catch (err) {
    console.warn('[cron] daily-digest send failed:', err instanceof Error ? err.message : err);
  }
}

console.log('\n✓ Cron complete');
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Smoke test — dry run**

Run: `npm run cron:dry -- --max=3`
Expected: completes successfully, prints result. Cron Log row is NOT appended in dry mode (we want dry to stay side-effect-free).

If the dry run *does* append to Cron Log, refactor the index.ts logic so `appendCronLogRow`, `pruneCronLog`, and the Telegram sends are gated behind `if (!flags.dryRun) { ... }`. Re-run.

- [ ] **Step 7: Smoke test — live run**

Run: `npm run cron -- --max=3`
Expected: 
- If new emails exist: items appended to sheet.
- A row appended to the Cron Log tab (verify by opening the sheet UI).
- Telegram message: only if errors OR current MT hour is 19.

- [ ] **Step 8: Commit**

```bash
git add apps/cron/index.ts
git commit -m "feat(cron): persist runs to Cron Log + conditional Telegram (errors / 7pm MT only)"
```

---

## Task 9: Skip Cron Log writes on dry runs

**Files:**
- Modify: `apps/cron/index.ts`

This task may already be done if you handled it in Task 8 Step 6. If `cron:dry` did NOT append a Cron Log row, you can skip this task.

- [ ] **Step 1: Wrap the Cron Log append + prune + Telegram send block in a non-dry-run guard**

In `apps/cron/index.ts`, surround the post-run block from "Persist this run" through the end of the Telegram conditional with:

```ts
if (!flags.dryRun) {
  // ... append, prune, telegram ...
}
```

- [ ] **Step 2: Verify cron:dry doesn't touch the sheet**

Run: `npm run cron:dry -- --max=3`
Expected: result printed, no "Cron Log" mention in output, no row in the sheet.

- [ ] **Step 3: Verify live cron does**

Run: `npm run cron -- --max=3`
Expected: a Cron Log row is appended.

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add apps/cron/index.ts
git commit -m "fix(cron): skip Cron Log write + Telegram in dry-run mode"
```

---

## Task 10: Add "Cron Log" tab to `scripts/bootstrap-sheet.ts`

**Files:**
- Modify: `scripts/bootstrap-sheet.ts`

- [ ] **Step 1: Open `scripts/bootstrap-sheet.ts` and find the tab-creation section**

Look for where the script creates the "All Purchases" tab — there will be `addSheet` requests or similar.

- [ ] **Step 2: Add a request to create "Cron Log" with the same 8-column header used by appendCronLogRow**

Add (after the existing tab additions):

```ts
// Cron Log — one row per cron run, used to build the 7pm daily digest.
{
  addSheet: { properties: { title: 'Cron Log' } },
},
```

And after `addSheet` batchUpdate completes, write the header row:

```ts
await sheets.spreadsheets.values.update({
  spreadsheetId,
  range: `'Cron Log'!A1`,
  valueInputOption: 'RAW',
  requestBody: {
    values: [[
      'Run Timestamp', 'Items Added', 'Items By Source', 'Items By Domain',
      'Returns Applied', 'Messages Scanned', 'Errors Count', 'Duration (s)',
    ]],
  },
});
```

(Match the surrounding code's style — if the script uses a list of `{ tab, header }` and a loop, extend that list instead.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/bootstrap-sheet.ts
git commit -m "chore(bootstrap): include Cron Log tab in fresh-sheet scaffold"
```

---

## Task 11: Switch Railway cron schedule to hourly

**Files:**
- Modify: `railway.cron.json`

- [ ] **Step 1: Update `cronSchedule`**

In `railway.cron.json`, change:

```json
"cronSchedule": "0 12,0 * * *"
```

to:

```json
"cronSchedule": "0 * * * *"
```

- [ ] **Step 2: Commit**

```bash
git add railway.cron.json
git commit -m "chore(railway): cron runs hourly (0 * * * *) instead of 2x/day"
```

---

## Task 12: Push the branch and let Railway redeploy

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Verify Railway picks up the deploy**

Wait ~2-3 minutes. The Railway dashboard should show new deploys for the cron service. The next scheduled run (at the next :00 UTC) will use the new hourly schedule, new query, new digest logic.

- [ ] **Step 3 (manual verification, not a commit):** open the Cron Log tab in the Google Sheet after the next hourly run completes. Confirm a new row appears.

---

## Task 13: One-time historical backfill from 2026-04-30

This is a manual one-off command after Railway has the new code live.

- [ ] **Step 1: Run the backfill locally**

```bash
npm run cron -- --reprocess --since=2026-04-30
```

This re-scans every Amazon/REI/return email since 2026-04-30 in inbox + trash + archive, dedups against the sheet via the strong key, and appends only items not already present.

- [ ] **Step 2: Verify**

Check the All Purchases tab for rows newly added with `Date Purchased` between 2026-04-30 and today that you didn't already have. If returns are surfaced, confirm matching rows are marked `Status=returned`.

(No commit — this is a runtime action, not a code change.)

---

## Task 14: Update DECISIONS.md, CLAUDE.md, PLAN.md

**Files:**
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/PLAN.md`

- [ ] **Step 1: Append a new DECISIONS.md entry**

Add (before the "How to use this file" footer):

```markdown
## 2026-05-15 — Trash-aware hourly cron + 7pm MT daily digest

**Context:** Twice-daily cron created a ~12-hour visibility window during which a user-deleted purchase email could be lost forever (Gmail's default search excludes Trash). Even when the user didn't delete anything, the up-to-12-hour latency between purchase and row appearing felt long.

**Decision:**
1. Gmail query gains `in:anywhere` so Trash + archive are both scanned.
2. Cron schedule moves from 2x/day to hourly (`0 * * * *` UTC on Railway).
3. New "Cron Log" sheet tab persists one row per run (auto-created on first write, auto-pruned to 30 days).
4. Telegram sending becomes conditional: immediate audible alert on any run with errors; a single audible daily summary at 19:00 Mountain time aggregated from the Cron Log; silent every other hour.
5. `apps/cron/pipeline.ts` is now side-effect-pure — it returns `PipelineResult` only. `apps/cron/index.ts` owns Cron Log writes and Telegram sends. This keeps `/scan` (which calls `runPipeline` directly from the bot) simple and free of pipeline-side notifications.

**Why:**
- Trash inclusion closes the "I deleted it before the cron ran" gap permanently. Strong-key dedup ensures safe re-scanning.
- Hourly cron tightens "appears in sheet" latency from ~12h to ~1h. Cost is negligible (Anthropic calls scale with parses, not runs; Railway compute is sub-cent).
- 1 audible message/day was Tom's stated comfort level. Errors are immediate because waiting 24h to learn the cron is broken defeats the heartbeat purpose.

**Trade-offs:** Spam folder is now also scanned as a free side effect of `in:anywhere` — accepted, strong-key dedup makes spurious matches harmless. If a run dies before writing its Cron Log row, that hour is invisible to the digest — accepted as an edge case.

**How to apply:**
- `apps/cron/pipeline.ts`: `buildQuery()` adds `in:anywhere`; runPipeline no longer sends Telegram.
- `apps/cron/index.ts`: appends Cron Log, prunes, decides send (errors / 7pm / silent).
- `apps/cron/digest.ts`: `formatDailySummary(rows, runCount)`, `formatErrorAlert(result)`, `shouldSendDailyDigestAt(now)`.
- `lib/sheets.ts`: `CronLogRow`, `appendCronLogRow`, `readCronLogToday`, `pruneCronLog`.
- `railway.cron.json`: `cronSchedule: "0 * * * *"`.
- `scripts/bootstrap-sheet.ts`: includes the Cron Log tab in fresh sheet bootstrap.
- One-time backfill: `npm run cron -- --reprocess --since=2026-04-30`.

---
```

- [ ] **Step 2: Update CLAUDE.md "Locked decisions" table — Cron row**

In `CLAUDE.md`, find the row `| Cron | 6am + 6pm Mountain Time |` and change it to:

```markdown
| Cron | Hourly (`0 * * * *` UTC). Telegram digest only at 19:00 Mountain (audible) — silent on every other hour. Errors trigger an immediate audible Telegram alert regardless of hour. |
```

- [ ] **Step 3: Update CLAUDE.md "Locked decisions" table — Notifications row**

Find the row about notifications (added 2026-05-15) and replace with:

```markdown
| Notifications | Telegram: (a) immediate audible alert on any cron run with errors, (b) one audible "daily summary" message at 19:00 Mountain time aggregating that day's Cron Log rows, (c) silent every other hour. `/scan` from the bot returns its own reply, separate from the cron's digest path. |
```

- [ ] **Step 4: Add a "Cron Log tab" note to the CLAUDE.md schema list**

Find the "Sheet schema" row and append (or amend) so it reads:

```markdown
| Sheet schema | **Tab "All Purchases":** 18 columns... (existing description). **Tab "Cron Log":** 8 columns recording each cron run (Run Timestamp, Items Added, Items By Source/Domain as JSON, Returns Applied, Messages Scanned, Errors Count, Duration). Used by the 7pm daily digest. Auto-created on first write, auto-pruned to 30 days. **Code accesses columns by HEADER NAME** in both tabs. |
```

- [ ] **Step 5: Update docs/PLAN.md cron section**

In `docs/PLAN.md`, find the "Cron" description and update to reflect hourly + Cron Log tab. Also update Task 1.7 (pipeline orchestration) to note that pipeline.ts is now side-effect-pure.

Search for: `6am + 6pm` and `Cron |` — update each reference.

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md CLAUDE.md docs/PLAN.md
git commit -m "docs: trash-aware hourly cron + 7pm digest in DECISIONS/CLAUDE/PLAN"
git push
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ `in:anywhere` (Task 1)
- ✅ Hourly schedule (Task 11)
- ✅ Cron Log tab + auto-create + auto-prune (Tasks 2-4, 9-10)
- ✅ Conditional digest: errors immediate, 7pm daily, silent otherwise (Tasks 6-8)
- ✅ Pipeline becomes pure (Task 5)
- ✅ Bootstrap script (Task 10)
- ✅ One-time backfill (Task 13)
- ✅ Docs (Task 14)

**Edge cases covered in tests:**
- buildQuery with all flag combinations
- appendCronLogRow with missing tab → auto-create
- readCronLogToday with empty / missing tab / mixed dates
- pruneCronLog descending-index delete to avoid shift bugs
- formatDailySummary with no activity, multi-source, log-read-failure
- shouldSendDailyDigestAt DST + standard time

**Risk:** Task 8 has the most logic; if anything else slips, the dry-run smoke test in Step 6 + live cron smoke test in Step 7 are the safety net.
