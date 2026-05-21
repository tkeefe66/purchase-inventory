# Mark Item Image as Incorrect — Design

**Date:** 2026-05-21
**Status:** Approved, ready for implementation plan
**Scope:** Web UI + sheet writes only. Re-resolve consumer is deferred.

## Problem

The cron's image-resolve chain (Brave → Sonnet) sometimes lands on the wrong image for an item. Today the only way to fix this in the web UI is the "Replace" button in the detail panel, which requires Tom to have a better image on hand. There's no lightweight way to say "this is wrong, throw it out" — and no persistent signal that a future re-resolve job could use to avoid picking the same bad URL again.

## Goal

Add a one-click action in the items page that:

1. Clears the row's `Image` cell.
2. Appends the previously-wrong URL to a persistent per-row reject list.

Reading that reject list back to drive a re-resolve job is **deferred** to a separate change. This spec only delivers the capture path.

## Non-goals

- Building the re-resolve worker (cron tick, script, or otherwise).
- Filtering the items table to show "previously flagged" rows. Image being empty is already a visible signal in the detail panel; that's enough for v1.
- Undo / restore. The reject list itself is the audit trail; if Tom wants the old image back he can paste the URL.
- A confirmation modal. Clearing the image is recoverable.

## User flow

1. Tom opens the items page, clicks a row → detail panel opens with image at top.
2. He hovers over the image → "Replace" button appears top-right (existing). A second small "⚠ Wrong image" button appears next to it (new).
3. He clicks "Wrong image" → spinner briefly shows → image disappears, row reverts to "+ Add image / paste URL" empty state.
4. In the background, the rejected URL is appended to the "Rejected Images" sheet tab with the row's identifiers.

## Architecture

### Storage: new sheet tab "Rejected Images"

Append-only log. Auto-created on first write, following the same pattern as `Cron Log` and `Maintenance Acked` in `lib/sheets.ts`.

| Column | Type | Notes |
|---|---|---|
| Order ID | string | The row's `orderId` |
| Product URL | string | The row's `productUrl` (joins back even if itemName drifts) |
| Item Name | string | Human-readable backup for log review |
| Rejected URL | string | The bad image URL that was cleared |
| Rejected At | string | ISO timestamp in Mountain time, matching existing sheet conventions |
| Source Before | string | `local` if the cleared value was a `/images/…` path; otherwise the URL's host |

Multiple rejections for the same item are separate rows — natural for a future resolver to dedupe.

### Server: new endpoint

`POST /app/api/items/[itemId]/image/reject/route.ts`

Mirrors the existing `POST /app/api/items/[itemId]/image/route.ts` style:

1. Resolve `itemId` → row via the same `${orderId}|${productUrl || itemName}` lookup.
2. Read the row's current `image` value.
3. If empty → 400 `{ error: 'no image to reject' }`.
4. Compute `Source Before` (local vs. host).
5. Call `appendRejectedImage(sheets, spreadsheetId, { orderId, productUrl, itemName, rejectedUrl, rejectedAt, sourceBefore })`.
6. Call `updateRowFields` to set the row's `image` to `''`.
7. Return `{ ok: true }`.

Order matters: append first, then clear. If the append fails, the image stays — better than a silent loss with no log entry. (Same principle as "sheet append must succeed before Gmail label is applied" in CLAUDE.md.)

### Shared infra: `lib/sheets.ts`

Add one helper:

```ts
export async function appendRejectedImage(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  entry: {
    orderId: string;
    productUrl: string;
    itemName: string;
    rejectedUrl: string;
    rejectedAt: string;
    sourceBefore: string;
  },
): Promise<void>
```

Implementation pattern matches the existing `appendMaintenanceAcked` / `appendCronLogRow` helpers:
- Constant `REJECTED_IMAGES_TAB = 'Rejected Images'` and `REJECTED_IMAGES_HEADERS = [...]` at top of file.
- If the tab doesn't exist, create it + write headers in one batch.
- Then append the row.

### UI: `app/components/detail-panel.tsx`

In `ImageBlock`:

1. Add a `rejecting` state (boolean) alongside the existing `uploading` state.
2. Add an `async function handleReject()` that POSTs to `/api/items/[itemId]/image/reject`, then `router.refresh()`.
3. When `row.image` is present and not in the URL-paste mode, render a second small button beside "Replace":
   - Label: `⚠ Wrong image`
   - Same opacity-on-hover treatment as Replace
   - On click: `handleReject()`
4. Error display reuses the existing red bottom strip.
5. While rejecting, show the same spinner overlay used for uploads (text: "Marking…").

The button is in the image overlay, not the row itself. Tom's original ask said "in the item table" but the table doesn't render images, so the detail panel is where the affordance naturally goes. The empty-image state is the visible signal in the table area.

## Files touched

- `lib/sheets.ts` — add `REJECTED_IMAGES_TAB`, `REJECTED_IMAGES_HEADERS`, `appendRejectedImage`
- `app/api/items/[itemId]/image/reject/route.ts` — new endpoint
- `app/components/detail-panel.tsx` — add "Wrong" button + handler + state
- `tests/sheets-rejected-images.test.ts` — unit test for `appendRejectedImage` (auto-create tab, append, idempotent header write)

## Error handling

| Failure | Behavior |
|---|---|
| Sheet append fails | Return 500, do NOT clear image. UI shows error strip. |
| Sheet append succeeds but clear-image update fails | Log row exists but image still shown. UI shows error; next click would re-append, which is acceptable for an audit log. |
| Item not found by `itemId` | 404 `{ error: 'item not found' }` (matches existing endpoint). |
| Image cell is already empty | 400 `{ error: 'no image to reject' }`. Button shouldn't be clickable in this state anyway (only renders when `row.image` is truthy), so this is a defensive check. |
| Missing env vars | 500, same handling as existing image endpoint. |

## Testing

- **Unit:** `appendRejectedImage` — auto-creates tab when missing, appends row in correct column order, doesn't re-write headers if tab exists.
- **Manual acceptance:** Open a row with an image, click "Wrong image", verify:
  - Image disappears in panel
  - "+ Add image" empty state returns
  - Sheet's "Rejected Images" tab has new row with correct fields
  - Sheet's "All Purchases" tab row has empty Image cell

No integration test against the live sheet — follows the existing pattern (the `/api/items/[itemId]/image` POST endpoint also has no e2e test).

## Open questions

None. Re-resolve consumer is explicitly out of scope and will be brainstormed separately.
