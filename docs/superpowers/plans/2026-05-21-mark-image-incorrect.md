# Mark Item Image as Incorrect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Wrong image" button to the item detail panel that clears the row's Image cell and appends the rejected URL to a new "Rejected Images" sheet tab. Captures the signal only — the re-resolve consumer is deferred.

**Architecture:**
- New sheet tab `Rejected Images` (append-only audit log, auto-created on first write — same pattern as `Maintenance Acked`).
- New API endpoint `POST /api/items/[itemId]/image/reject` that appends to the log then clears the row's image.
- New button in the detail panel's `ImageBlock` next to the existing "Replace" button.

**Tech Stack:** TypeScript 5, Next.js 14 App Router, googleapis sheets_v4, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-21-mark-image-incorrect-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `lib/sheets.ts` | Add `REJECTED_IMAGES_TAB`, `REJECTED_IMAGES_HEADER`, `ensureRejectedImagesTab`, `appendRejectedImage` |
| Create | `tests/lib/sheets-rejected-images.test.ts` | Unit tests for `appendRejectedImage` |
| Create | `app/api/items/[itemId]/image/reject/route.ts` | POST endpoint — append log row + clear image |
| Modify | `app/components/detail-panel.tsx` | Add "Wrong image" button + reject handler in `ImageBlock` |

---

## Task 1: Sheet helper — `appendRejectedImage`

**Files:**
- Modify: `lib/sheets.ts` (add new constants + functions after the `appendMaintenanceAck` block, around line 1042)
- Test: `tests/lib/sheets-rejected-images.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/lib/sheets-rejected-images.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { appendRejectedImage } from '../../lib/sheets.js';

const HEADER = ['Order ID', 'Product URL', 'Item Name', 'Rejected URL', 'Rejected At', 'Source Before'];

function mockSheets(opts: { existingTabs: string[] }) {
  const updated: { range: string; values: unknown[][] }[] = [];
  const appended: unknown[][] = [];
  const created: string[] = [];
  const sheets = {
    spreadsheets: {
      get: vi.fn().mockResolvedValue({
        data: { sheets: opts.existingTabs.map((t) => ({ properties: { title: t } })) },
      }),
      batchUpdate: vi.fn(async (req: { requestBody: { requests: { addSheet: { properties: { title: string } } }[] } }) => {
        for (const r of req.requestBody.requests) created.push(r.addSheet.properties.title);
        return { data: {} };
      }),
      values: {
        update: vi.fn(async (req: { range: string; requestBody: { values: unknown[][] } }) => {
          updated.push({ range: req.range, values: req.requestBody.values });
          return { data: {} };
        }),
        append: vi.fn(async (req: { requestBody: { values: unknown[][] } }) => {
          appended.push(...req.requestBody.values);
          return { data: {} };
        }),
      },
    },
  };
  return { sheets, updated, appended, created };
}

describe('appendRejectedImage', () => {
  test('appends a new row when tab exists', async () => {
    const { sheets, appended, created } = mockSheets({ existingTabs: ['Rejected Images'] });
    await appendRejectedImage(sheets as never, 'sid', {
      orderId: 'A123',
      productUrl: 'https://example.com/p',
      itemName: 'Test Jacket',
      rejectedUrl: 'https://cdn.example.com/wrong.jpg',
      rejectedAt: '2026-05-21T19:00:00-06:00',
      sourceBefore: 'cdn.example.com',
    });
    expect(created).not.toContain('Rejected Images');
    expect(appended).toHaveLength(1);
    expect(appended[0]).toEqual([
      'A123',
      'https://example.com/p',
      'Test Jacket',
      'https://cdn.example.com/wrong.jpg',
      '2026-05-21T19:00:00-06:00',
      'cdn.example.com',
    ]);
  });

  test('creates the tab and writes headers when missing', async () => {
    const { sheets, appended, created, updated } = mockSheets({ existingTabs: ['All Purchases'] });
    await appendRejectedImage(sheets as never, 'sid', {
      orderId: 'A123',
      productUrl: '',
      itemName: 'Test Jacket',
      rejectedUrl: '/images/abc.jpg',
      rejectedAt: '2026-05-21T19:00:00-06:00',
      sourceBefore: 'local',
    });
    expect(created).toContain('Rejected Images');
    expect(updated).toEqual([
      { range: `'Rejected Images'!A1`, values: [HEADER] },
    ]);
    expect(appended).toHaveLength(1);
  });

  test('does not re-write headers when tab already exists', async () => {
    const { sheets, updated } = mockSheets({ existingTabs: ['Rejected Images'] });
    await appendRejectedImage(sheets as never, 'sid', {
      orderId: 'A123',
      productUrl: '',
      itemName: 'X',
      rejectedUrl: 'https://example.com/x.jpg',
      rejectedAt: '2026-05-21T19:00:00-06:00',
      sourceBefore: 'example.com',
    });
    expect(updated).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/sheets-rejected-images.test.ts`

Expected: FAIL — `appendRejectedImage` is not exported from `lib/sheets.ts`.

- [ ] **Step 3: Implement `appendRejectedImage` in `lib/sheets.ts`**

Append this block to `lib/sheets.ts` immediately after the `appendMaintenanceAck` function (around line 1042, before the next `// ---` section divider):

```ts
// ---------------------------------------------------------------------------
// Rejected Images tab
// ---------------------------------------------------------------------------
//
// Append-only log of image URLs Tom has flagged as wrong via the web UI.
// The web endpoint appends here AND clears the row's Image cell. A future
// re-resolve job will consume this list to skip previously-rejected URLs
// per row. That consumer is intentionally NOT built yet — this is capture
// only (decided 2026-05-21).

const REJECTED_IMAGES_TAB = 'Rejected Images';
const REJECTED_IMAGES_HEADER = [
  'Order ID',
  'Product URL',
  'Item Name',
  'Rejected URL',
  'Rejected At',
  'Source Before',
] as const;

async function ensureRejectedImagesTab(sheets: SheetsClient, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = (meta.data.sheets ?? []).some((s) => s.properties?.title === REJECTED_IMAGES_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: REJECTED_IMAGES_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${REJECTED_IMAGES_TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [Array.from(REJECTED_IMAGES_HEADER)] },
    });
  }
}

export async function appendRejectedImage(
  sheets: SheetsClient,
  spreadsheetId: string,
  entry: {
    orderId: string;
    productUrl: string;
    itemName: string;
    rejectedUrl: string;
    rejectedAt: string;
    sourceBefore: string;
  },
): Promise<void> {
  await ensureRejectedImagesTab(sheets, spreadsheetId);
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${REJECTED_IMAGES_TAB}'!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[
        entry.orderId,
        entry.productUrl,
        entry.itemName,
        entry.rejectedUrl,
        entry.rejectedAt,
        entry.sourceBefore,
      ]],
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/sheets-rejected-images.test.ts`

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Run full typecheck**

Run: `npm run typecheck`

Expected: PASS, no new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/sheets.ts tests/lib/sheets-rejected-images.test.ts
git commit -m "feat(sheets): appendRejectedImage helper + Rejected Images tab"
```

---

## Task 2: API endpoint — `POST /api/items/[itemId]/image/reject`

**Files:**
- Create: `app/api/items/[itemId]/image/reject/route.ts`

This endpoint mirrors the existing `app/api/items/[itemId]/image/route.ts` for the env-loading and row-lookup pattern. There is no separate unit test for this route — the existing image POST endpoint also has none, and the underlying `appendRejectedImage` helper is fully covered. Manual acceptance covers the integration.

- [ ] **Step 1: Create the endpoint**

Create `app/api/items/[itemId]/image/reject/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import {
  appendRejectedImage,
  createSheetsClient,
  readMasterRows,
  updateRowFields,
} from '../../../../../../lib/sheets.js';

export const runtime = 'nodejs';

function readEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
} {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];
  const spreadsheetId = process.env['GOOGLE_SHEET_ID'];
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    throw new Error('Missing required env vars for Sheets access');
  }
  return { clientId, clientSecret, refreshToken, spreadsheetId };
}

function classifySource(imageRef: string): string {
  if (imageRef.startsWith('/images/')) return 'local';
  try {
    return new URL(imageRef).host;
  } catch {
    return 'unknown';
  }
}

/**
 * Mark the row's current image as wrong. Appends a row to the "Rejected
 * Images" sheet tab capturing the bad URL, then clears the row's Image cell
 * so the UI reverts to the empty/upload state. Append happens BEFORE clear
 * so a failed log doesn't silently lose the rejected URL.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const { itemId } = await ctx.params;

  let env: ReturnType<typeof readEnv>;
  try {
    env = readEnv();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'server misconfiguration' },
      { status: 500 },
    );
  }

  const sheets = createSheetsClient(env);
  const rows = await readMasterRows(sheets, env.spreadsheetId);
  const idx = rows.findIndex(
    (r) => `${r.orderId}|${r.productUrl || r.itemName}` === itemId,
  );
  if (idx === -1) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 });
  }

  const row = rows[idx]!;
  const currentImage = row.image.trim();
  if (!currentImage) {
    return NextResponse.json({ error: 'no image to reject' }, { status: 400 });
  }

  const rejectedAt = formatInTimeZone(new Date(), 'America/Denver', "yyyy-MM-dd'T'HH:mm:ssXXX");

  await appendRejectedImage(sheets, env.spreadsheetId, {
    orderId: row.orderId,
    productUrl: row.productUrl,
    itemName: row.itemName,
    rejectedUrl: currentImage,
    rejectedAt,
    sourceBefore: classifySource(currentImage),
  });

  await updateRowFields(sheets, env.spreadsheetId, [
    { rowIndex: idx + 2, fields: { image: '' } },
  ]);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS, no new errors. (Both tsconfigs run — Next.js bundler mode covers the new route file.)

- [ ] **Step 3: Commit**

```bash
git add app/api/items/[itemId]/image/reject/route.ts
git commit -m "feat(web): POST /api/items/[itemId]/image/reject endpoint"
```

---

## Task 3: UI — "Wrong image" button in `ImageBlock`

**Files:**
- Modify: `app/components/detail-panel.tsx` (the `ImageBlock` component, lines 119-262)

- [ ] **Step 1: Add the `rejecting` state and `handleReject` function inside `ImageBlock`**

Edit `app/components/detail-panel.tsx`. After the existing `useState` declarations and `inputRef` (currently lines 121-125), the existing block reads:

```tsx
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'url'>('idle');
  const [urlValue, setUrlValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;
```

Add `rejecting` state immediately after `uploading`:

```tsx
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'url'>('idle');
  const [urlValue, setUrlValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemId = `${row.orderId}|${row.productUrl || row.itemName}`;
```

- [ ] **Step 2: Add `handleReject` function**

Immediately after the existing `handleUrl` function (currently ends around line 161 with the closing `}`), add:

```tsx
  async function handleReject() {
    setRejecting(true);
    setError(null);
    try {
      const resp = await fetch(`/api/items/${encodeURIComponent(itemId)}/image/reject`, {
        method: 'POST',
      });
      if (!resp.ok) {
        const j = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${resp.status}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reject failed');
    } finally {
      setRejecting(false);
    }
  }
```

- [ ] **Step 3: Add the "Wrong image" button next to the existing "Replace" button**

The existing Replace block (lines 231-239) currently reads:

```tsx
      {row.image && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="absolute right-2 top-2 rounded-input bg-bg-surface/80 px-2 py-1 text-[11px] text-text-secondary opacity-0 transition group-hover:opacity-100"
        >
          Replace
        </button>
      )}
```

Replace that block with:

```tsx
      {row.image && (
        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={rejecting}
            className="rounded-input bg-bg-surface/80 px-2 py-1 text-[11px] text-text-secondary disabled:opacity-50"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => void handleReject()}
            disabled={rejecting}
            className="rounded-input bg-bg-surface/80 px-2 py-1 text-[11px] text-text-secondary hover:text-red-400 disabled:opacity-50"
          >
            ⚠ Wrong image
          </button>
        </div>
      )}
```

- [ ] **Step 4: Update the spinner overlay text to handle the rejecting state**

The existing uploading-overlay block (lines 240-244) reads:

```tsx
      {uploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[12px] text-white">
          {mode === 'url' ? 'Fetching…' : 'Uploading…'}
        </div>
      )}
```

Replace with:

```tsx
      {(uploading || rejecting) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-[12px] text-white">
          {rejecting ? 'Marking…' : mode === 'url' ? 'Fetching…' : 'Uploading…'}
        </div>
      )}
```

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS, no new errors.

- [ ] **Step 6: Run any existing detail-panel tests**

Run: `npx vitest run --reporter=verbose | grep -i "detail-panel\|items-table" || echo "no tests"`

Expected: PASS (or "no tests" if none exist for these components).

- [ ] **Step 7: Manual acceptance — start dev server and test**

Run: `npm run dev`

Then in a browser at `http://localhost:3000` (Basic Auth: `WEB_USER` / `WEB_PASSWORD`):

1. Open the items page.
2. Click any row that currently has an image → detail panel opens.
3. Hover over the image → confirm "Replace" and "⚠ Wrong image" buttons appear top-right.
4. Click "⚠ Wrong image" → spinner shows "Marking…", then image disappears and "+ Add image / paste URL" empty state returns.
5. In Google Sheets, open the spreadsheet:
   - Confirm new "Rejected Images" tab exists with header row `Order ID | Product URL | Item Name | Rejected URL | Rejected At | Source Before`.
   - Confirm a new data row matches the item you just flagged.
   - Confirm that item's `Image` cell in "All Purchases" is now blank.
6. Open another item with an image and repeat — confirm a second row appended to "Rejected Images" (not a duplicate header).

Stop the dev server when done (Ctrl-C).

- [ ] **Step 8: Commit**

```bash
git add app/components/detail-panel.tsx
git commit -m "feat(web): Wrong image button in item detail panel"
```

---

## Self-Review

**Spec coverage:**
- ✅ "Where the action lives" → Task 3 adds button to `ImageBlock`
- ✅ "Storage: new sheet tab" with 6 columns → Task 1 constants `REJECTED_IMAGES_HEADER`
- ✅ "Server changes" — new endpoint, 400 on empty image, append-then-clear order → Task 2
- ✅ "Shared infra: `lib/sheets.ts`" → Task 1 `appendRejectedImage`
- ✅ "Files touched" matches plan exactly
- ✅ "Error handling" matrix — empty image → 400, item not found → 404, append failure leaves image intact (because clear comes after append) → Task 2 ordering
- ✅ "Testing" — unit tests for the helper + manual acceptance script → Tasks 1 + 3 Step 7
- ✅ "What we're NOT building" — no re-resolve, no filter, no undo → none of these appear in any task

**Placeholder scan:** No "TBD", no "add appropriate error handling", no "implement later". Every step has the actual code or command.

**Type consistency:** `appendRejectedImage` signature is identical in Task 1 (implementation) and Task 2 (call site). The 6 header column names match between the constant, the test expectations, and the manual acceptance check. `itemId` lookup string `${r.orderId}|${r.productUrl || r.itemName}` matches the existing image POST endpoint exactly.
