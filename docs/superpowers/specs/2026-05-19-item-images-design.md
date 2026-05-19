# Item Images Design

**Date:** 2026-05-19
**Status:** Awaiting Tom review
**Phase:** Web UI v1.1 — additive, no phase reshuffle
**Author:** Brainstormed with Claude

---

## Problem

The web UI item detail panel (`app/components/detail-panel.tsx`, currently on `main`) shows a row's brand, item name, price, status, and metadata — but no product image. For a personal gear inventory the visual is often what makes the page useful ("which jacket is this again?"). The sheet has no image data; nothing in the ingest pipeline captures images today.

The five item sources have very different image situations:

| Source | Image availability |
|---|---|
| Amazon shipment / order emails | HTML contains CDN URLs (`m.media-amazon.com/images/I/…`) |
| REI shipment / online orders | HTML contains REI CDN URLs (`images.rei.com`) |
| REI in-store eReceipts | No images in receipt; synthesized product URL |
| `/addgear` photo via Telegram | Photo bytes available in-process, currently discarded |
| Historical CSV import | No image, no email |

A single solution needs to cover all five.

## Goals

1. Each row in "All Purchases" can have an associated image stored on the Railway volume, surfaced in the web detail panel.
2. New ingests automatically attach an image when possible — email-extracted first, AI-resolved fallback for everything else.
3. Existing ~1500 rows are backfilled via a one-shot script.
4. Tom can manually attach or replace an image from both the web UI and Telegram (`/addgear` flow).
5. Failure to find an image never blocks an ingest — the row writes with a blank `Image` column.

## Non-goals

- Image editing, cropping, multiple images per item, or galleries.
- Image optimization / resize / format conversion in v1 (`sharp` deferred).
- Public sharing or unauthenticated access to images.
- Telegram-side bulk attach. The web UI handles batch backfill cleanup.

## Locked decisions

| Topic | Decision |
|---|---|
| Storage | Railway volume `/data/images/<imageId>.<ext>` on both web and cron services. Web service gets `/data` mount added to `railway.web.json` (new — was previously volume-free). |
| Hotlink vs. download | Always download. Four of the five sources need local storage anyway; single-path is simpler than branching by source. |
| Schema | New sheet column `Image` (becomes column 19 in "All Purchases"); stores relative path `/images/<imageId>.<ext>`; empty string when missing. `MasterRow.image: string` joins `lib/types.ts`. |
| `imageId` | Deterministic from itemId so re-ingests overwrite, not duplicate. |
| Serving | Next.js route handler reads from `/data/images/`. `<img src={row.image}>` directly — no Next `<Image>` optimization. |
| AI lookup trigger | Auto on every cron ingest. Email extraction first; if no URL, fall back to Sonnet 4.6 + `web_search` (`lib/integrations/image-lookup.ts`). |
| Lookup cost | ~$0.03 per uncovered item. Persistent cache at `/data/image-url-cache.json` (same pattern as the dispersed URL resolver) makes re-runs free. |
| Backfill | One-shot `scripts/backfill-images.ts`, modeled on `seed-dispersed.ts`: cost-confirm prompt + `--yes` bypass. Email re-parse first (covers most), AI lookup second. **Must set `includeSpamTrash: true` (or `in:anywhere`)** on the Gmail search since many archived order emails live in Trash. |
| Manual upload — Web | `POST /api/items/[itemId]/image` (multipart) behind existing HTTP Basic Auth. Writes to volume, updates sheet, returns image URL. Small carve-out from "web UI is read-only" — `Image` is the only writable column. |
| Manual upload — Telegram | No new command. `/addgear` extended: when fuzzy-match hits an existing row, offer Attach (no image yet) / Replace (image exists) / Create-new-anyway / Cancel. |
| Failure mode | Image fetch / lookup failures never block the row write. Row lands with blank `Image`, surfaces a placeholder in the detail panel. |
| Image size cap | Reject uploads > 10MB. Originals kept in storage; ~1500 items × ~300KB ≈ 450MB on the volume (well within allocation). |

## Architecture

```
                  ┌──────────────────────────────┐
  Cron ingest ───>│ resolveImage(row, emailHtml) │
                  └──────────────┬───────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   email-extract            AI lookup                /addgear bytes
  (parsers/*.ts)         (image-lookup.ts)         (parsers/photo.ts)
        │                        │                        │
        └───────────────┬────────┴────────────┬───────────┘
                        │                     │
                        ▼                     ▼
              ┌──────────────────────────────────────┐
              │ image-storage.ts                     │
              │  saveItemImage(itemId, bytes, type)  │
              │  downloadAndSave(itemId, url)        │
              └──────────────────┬───────────────────┘
                                 │
                          /data/images/<imageId>.<ext>
                          + sheet "Image" column updated
                                 │
       ┌─────────────────────────┴─────────────────────────┐
       │                                                   │
       ▼                                                   ▼
  Web detail panel                              POST /api/items/[itemId]/image
  (read /data/images/)                         (manual upload from web UI)

  Telegram /addgear                            Telegram /addgear fuzzy-match
  (new row + photo bytes)                      Attach/Replace existing row
```

`lib/` is pure infrastructure (no domain imports). `domains/` is unchanged.

## Module breakdown

### New

- **`lib/integrations/image-storage.ts`** — single seam for image persistence.
  - `imageId(itemId: string): string` — deterministic mapping.
  - `saveItemImage(itemId, bytes, mediaType): Promise<{ ok: true, path } | { ok: false, error }>`
  - `downloadAndSave(itemId, url): Promise<{ ok: true, path } | { ok: false, error: 'fetch_failed' | 'bad_type' | 'too_large' }>` — 5s timeout, content-type validation, 10MB cap.
- **`lib/integrations/image-lookup.ts`** — Sonnet 4.6 + `web_search`, mirrors the shape of `lib/parsers/rei-product-lookup.ts`. Inputs: `brand`, `itemName`, `productUrl`. Output: canonical product image URL (string) or null. Backed by `/data/image-url-cache.json` (canonical results forever, `tried-null` honored 30 days, same cache discipline as the dispersed URL resolver).
- **`scripts/backfill-images.ts`** — one-shot. Phases: (1) report + confirm + `--yes` bypass, (2) email re-parse for Amazon/REI rows with orderId (using `includeSpamTrash: true`), (3) AI lookup for everything else, (4) per-row error recovery with final summary. Skips rows that already have `Image` populated → idempotent.
- **`app/api/items/[itemId]/image/route.ts`** — multipart `POST`. Authn via existing basic-auth middleware. Validates content-type (jpg/png/webp) + size (≤ 10MB). Calls `saveItemImage` + sheet `Image` update.
- **`tests/integrations/image-storage.test.ts`**, **`tests/integrations/image-lookup.test.ts`**, **`tests/lib/parsers/*-image.test.ts`** — vitest, fixture-driven for the parser extensions.

### Modified

- **`lib/types.ts`** — `image: string` added to `MasterRow`.
- **`lib/sheets.ts`** — `'Image'` appended to `MASTER_HEADERS`; `FIELD_TO_HEADER` gets `image → 'Image'`. `bootstrap-sheet` will pick this up automatically.
- **`lib/parsers/rei.ts`** — extract product `<img src>` per line item using existing cheerio traversal.
- **`lib/parsers/amazon-shipment.ts`** — already iterates IMG tags for prices; capture `src` alongside.
- **`lib/parsers/amazon-order.ts`** — Haiku prompt extended with one new field per line item (image URL).
- **`lib/parsers/photo.ts`** — return image bytes (or persisted path) alongside `PhotoExtraction` so `/addgear` can persist them at the call site instead of discarding.
- **`apps/cron/pipeline.ts`** — `resolveImage()` step between `classify` (line ~105) and `appendRows` (line ~196). Runs per row inside `processOrderOrShipmentMessage`. Returns `{ path: string }` or `{ path: '' }`; failure is non-fatal.
- **`apps/bot/commands/addgear.ts`** — fuzzy-match branch extended: when a match is found, present Attach / Replace / Create-new-anyway / Cancel options. Uses existing `addgearState` machinery.
- **`apps/bot/preview.ts`** — confirm message includes the photo (Telegram-native, just send the image with the confirm prompt).
- **`lib/dedup.ts`** — small helper exposing "does the matched row already have an image?" for the `/addgear` branching logic.
- **`app/components/detail-panel.tsx`** — image block above the header section, 4:3 aspect-ratio container, dashed-border placeholder with upload affordance when blank, hover "Replace" overlay when present, file picker + drag-and-drop input wired to the new API route. Detail panel also surfaces the 6-char Short ID so Tom can copy it (matches the `/ack-maintenance` ID convention).
- **`railway.web.json`**, **`railway.cron.json`** — `/data` volume mount on both services. (Web service has not used `/data` before; mount requires a Railway dashboard action since the volume already exists.)
- **`CLAUDE.md`** — sheet schema table updated to 19 columns; integrations table gets an "Image storage" row noting the `/data/images/` location and that `Image` is the only web-writable column.
- **`DECISIONS.md`** — append three decisions: (a) store locally vs hotlink, (b) AI lookup on every cron ingest (cost commitment), (c) `/addgear` as the single Telegram entry point for image manipulation.

## Pipeline detail

### Ingest (cron + bot)

For each new row, after classification and before sheet append:

```
1. If source = Image (/addgear): photo bytes are in hand → saveItemImage → done.
2. Else, try email-extracted URL from the parser.
   2a. If present → downloadAndSave(itemId, url). On success: row.image = path.
3. Else, image-lookup.ts(brand, itemName, productUrl) → URL.
   3a. If present → downloadAndSave(itemId, url).
4. Else, leave row.image = ''.
```

All steps fail-soft. A blank `image` is a normal outcome.

### Web detail panel UX

- **Blank state:** dashed-border 4:3 placeholder with a centered upload icon + "Add image" text. Clicking anywhere on the placeholder opens the file picker. Drag-and-drop onto the placeholder also works.
- **Image present:** 4:3 container, `object-fit: cover`. Hover reveals a small "Replace" button in the top-right corner.
- **Uploading state:** spinner overlay, disable the picker.
- **Error state:** brief toast, picker re-enabled.
- After successful upload, `router.refresh()` revalidates the server component.

### Telegram `/addgear` UX

Existing flow, augmented at the fuzzy-match branch:

- **No fuzzy match → existing behavior** + photo bytes saved as the new row's image.
- **Fuzzy match, matched row has no image** → bot replies: "Looks like this matches *L.L.Bean Men's Bean Boots 8" (2021)* — that row has no image. Attach this photo to it?" with inline buttons Attach / Create new / Cancel.
- **Fuzzy match, matched row already has an image** → bot replies: "Looks like this matches *...(2021)*. Replace its image?" with inline buttons Replace / Create new / Cancel.

## Risks & open considerations

- **Volume mount on web service.** Web service in Railway has not previously needed `/data`. Adding the mount requires a Railway dashboard step (volumes can only mount on services in the same project — they already are). Worth confirming the bucket / volume size headroom before the backfill run.
- **AI cost is ongoing.** Cron lookup is recurring ($0.10–$1/day typical, depending on buying patterns). Cache amortizes repeats. Acceptable given the comprehensive-scope choice.
- **Backfill cost.** ~$20–40 one-time, estimated at confirm-prompt time before any spend.
- **Parser fixtures.** Need a few new fixtures per parser (one Amazon shipment with images, one REI online order with images, one Amazon order/Haiku case). Should be quick to capture from Tom's existing Gmail.
- **Image URL stability.** Email CDNs (Amazon, REI) are stable historically but not guaranteed. Storing locally means we're insulated regardless.
- **Sheet column ordering.** Adding `Image` at position 19 assumes no one is depending on column count. Code accesses columns by header name (`buildHeaderMap` in `lib/sheets.ts`) so this is safe. Bootstrap script will add the column on the next `npm run bootstrap-sheet`.

## Testing

- Vitest unit tests for `image-storage.ts` (download success, bad content-type, too-large, idempotent overwrite) and `image-lookup.ts` (cache hit, cache miss persisted, null caching).
- Fixture-driven parser tests (Amazon shipment, Amazon order, REI online order) confirming image URL is extracted alongside item metadata.
- Manual acceptance: bootstrap sheet → cron one new Amazon shipment → verify image renders in detail panel. Then `/addgear` with a photo of an item already in the sheet → verify Attach path. Then backfill one row manually via the web upload button.

## Sequencing

This spec is intentionally one cohesive change. Phasing within the implementation plan will probably split it as:

1. Schema + storage primitive (image-storage.ts + sheet column + types + bootstrap-sheet) — no behavior change yet.
2. Parser extensions (Amazon + REI) with fixtures.
3. Cron ingest wiring + image-lookup.ts + cache.
4. Backfill script.
5. Web detail panel UI + API route.
6. `/addgear` fuzzy-match extension.
7. Docs updates (CLAUDE.md, DECISIONS.md) and Railway volume mount.

That's a `writing-plans` exercise after this spec is approved.
