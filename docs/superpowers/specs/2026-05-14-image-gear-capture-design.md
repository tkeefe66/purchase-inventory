# Image-Sourced Gear Capture Design

**Date:** 2026-05-14
**Status:** Awaiting Tom review
**Phase:** Phase 2.x (post-bot listener) — small feature, no phase reshuffle
**Author:** Brainstormed with Claude

---

## Problem

The sheet captures purchases ingested from Gmail (REI + Amazon). It does not capture gear Tom already owns — gifts, in-store purchases, hand-me-downs, items bought before email ingestion was wired up. There are no receipts for these items, but Tom can photograph them.

Without these rows, the outdoor agent's inventory grounding is incomplete: it'll confidently answer "you don't own a hardshell" when in fact Tom has one bought at REI Boulder in 2019 with no email trail.

## Goals

1. Tom can add a piece of physical gear to the sheet by sending one Telegram message with a photo and `/addgear` caption.
2. The system extracts what it can from the image (brand, item name, color, size) and conversationally fills the rest (date purchased, price).
3. Photo-sourced rows are visually distinct in the sheet (`Source = Image`) so Tom can audit "what came from photos vs. emails."
4. Duplicate detection against existing email-ingested rows is automatic — Tom is warned, not silently double-counted.

## Non-goals

- Bulk photo upload. Volume is small (~5–20 items); one-at-a-time via Telegram is sufficient.
- A web form. The Phase 6 dashboard remains read-only.
- Logging non-photo manual entries. If Tom wants to type a row by hand, he uses the sheet UI directly. (`Image` is specifically photo-sourced.)
- Recovering from Telegram message edits/deletions or supporting image re-processing if vision is wrong (Tom corrects fields directly via `field: value`, no second vision call).
- Cross-domain image capture in v1. The classifier handles domain assignment as it does for email-ingested rows; outdoor is the only domain wired through, but the image path itself is domain-agnostic.

## Decision summary

**Approach: photo + `/addgear` caption triggers a conversational state machine in the Telegram bot.** Vision extracts confident fields, bot prompts for the rest one at a time, fuzzy-matches against the sheet before writing, and asks Tom to confirm. Source is `Image`, synthetic Order ID is `IMG-<YYYYMMDD>-<short-hash>`.

Rationale: Telegram is already the bot surface and has `ConversationStore` + `PendingActionStore` plumbing. Using a `/addgear` caption (vs. implicit photo-handling) keeps photos as a general-purpose input for future features (trail-ID, plant-ID, etc.).

---

## Architecture

### File layout

```
lib/
  parsers/
    photo.ts            # NEW — vision extraction from image + caption
  dedup.ts              # EDIT — add fuzzyMatchExisting(brand, itemName)
  types.ts              # EDIT — add 'Image' to SOURCE_VALUES
  models.ts             # EDIT — add vision model entry (Sonnet 4.6)

apps/bot/
  commands/
    addgear.ts          # NEW — orchestrates the capture state machine
  index.ts              # EDIT — extract msg.photo + msg.caption from updates, pass to router
  router.ts             # EDIT — add routePhoto(chatId, photo, caption, deps); dispatch /addgear captions to commands/addgear.ts

tests/fixtures/
  photos/               # NEW — real gear photos + *.expected.json shape assertions
```

Architectural rule check: all new code is in `lib/` (pure infrastructure) and `apps/bot/` (wiring). Nothing in `domains/outdoor/`. Photo capture is domain-agnostic; the existing classifier in `lib/classifier.ts` decides domain after extraction.

### Components

**`lib/parsers/photo.ts`** — pure function. Input: `{imageBytes: Buffer, caption: string}`. Output: `{brand?: string, itemName?: string, color?: string, size?: string, confidence: {brand: 'high'|'low'|'missing', ...}}`. Uses Claude vision (Sonnet 4.6) with a cached system prompt instructing it to read tags/labels and return JSON. Pure: no I/O, mirrors `parsers/rei.ts` and `parsers/amazon.ts`.

**`lib/dedup.ts` `fuzzyMatchExisting`** — pure function. Input: `(brand: string, itemName: string, existingRows: MasterRow[])`. Output: `{row: number, brand: string, itemName: string, score: number}[]` ranked best-first, top 3. Algorithm: lowercase + trim + collapse whitespace on both sides; tokenize on whitespace; score with Jaccard similarity over `(brand ∪ itemName)` token sets. Threshold for inclusion in candidates: `score ≥ 0.5`. No LLM — deterministic and cheap. Caller (the bot command) decides what to do with the candidates.

**`apps/bot/commands/addgear.ts`** — the state machine. Loads existing inventory via `inventoryCache.ts`, holds per-chat state in `ConversationStore`, parks final row in `PendingActionStore` for the `yes`/`no` confirm.

### State machine

```
state = {
  kind: 'addgear',
  step: 'awaiting-date'
      | 'awaiting-price'
      | 'awaiting-size'             // only when vision missed it and item is sized
      | 'awaiting-dedup-decision'
      | 'awaiting-confirm',
  draft: Partial<MasterRow>,
  dedupCandidates?: Array<{row: number, brand: string, itemName: string, score: number}>,
  imageRef: string,                 // Telegram file_id
}
```

### Data flow (the 6-step capture loop)

```
1. Photo + "/addgear ..." arrives
       ↓
2. parsers/photo.ts vision extract  →  partial {brand, itemName, color, size}
       ↓
3. lib/classifier.ts classify       →  {domain, category, subCategory, itemType}
       ↓
4. For each missing/low-confidence field in [date, price, size]:
       prompt Tom → store answer → loop
       ↓
5. dedup.ts fuzzyMatchExisting(brand, itemName)
       no match  →  step 6
       match(es) →  show top 3 + "add anyway / cancel / mark existing as N"
                    cancel → drop state
                    mark   → out of v1 scope; treat as "add anyway"
       ↓
6. Show full proposed row → PendingActionStore parks it →
       "yes" → sheets.append → reply "added row N" → done
       "field: value" → patch draft → re-show
       "cancel" → drop state, nothing written
```

### Synthetic identifiers

- `Source` column: literal string `Image` (added to `SOURCE_VALUES` and to the Sheet's data-validation dropdown).
- `Order ID` column: `IMG-<YYYYMMDD>-<6char-hash>` where the hash is the first 6 hex chars of `SHA-256(brand + '|' + itemName + '|' + color + '|' + size + '|' + Date.now())`. The timestamp component guarantees uniqueness even for identical resubmissions; the dedup key `(Order ID, Item Name, Color, Size)` is therefore unique by construction for image rows.
- `Status` column: `active` (default).
- `Reasoning` column: `"captured via /addgear photo"`.
- `Date Purchased`: from Tom's reply, or blank if he genuinely doesn't know.
- `Year`: derived from `Date Purchased` if present, else blank.
- `Price (Paid)`: from Tom's reply, or blank.

---

## Schema changes

| File / Resource | Change |
|---|---|
| `lib/types.ts` | `SOURCE_VALUES = ['REI', 'Amazon', 'Other', 'Image'] as const` |
| `lib/models.ts` | Add `VISION_MODEL` entry pointing at Sonnet 4.6, with pricing |
| Google Sheet `Source` column | Add `Image` to the data-validation dropdown (one-time manual step) |

No new columns. No changes to existing columns. The 18-column schema and `(Order ID, Item Name, Color, Size)` dedup key are preserved.

---

## Error handling

| Failure | Behavior |
|---|---|
| Vision extracts neither brand nor item name | Reply: `"Couldn't read brand or item name. Reply 'brand: X, item: Y' or send a clearer photo."` Don't auto-retry. |
| Fuzzy dedup has multiple plausible matches | Show top 3 with row numbers; Tom picks or replies `none`. |
| Sheet append fails | Log error, reply `"Couldn't write: <reason>. Reply 'retry' to retry."` Keep the `PendingAction` alive — retry doesn't redo the flow. |
| Telegram file fetch fails | Reply with the error, drop state. No partial draft to save. |
| Tom sends noise mid-confirm | Re-show proposed row with hint: `"Reply 'yes', 'field: value', or '/cancel'."` |
| Conversation timeout | Match `ConversationStore`'s existing TTL. On expiry, drop silently. |
| Second `/addgear` arrives mid-flow | Reply `"You have an unfinished gear capture — finish or /cancel?"` Don't clobber. |

Explicit non-goals: no recovery from Telegram message edits/deletions, no re-vision (Tom corrects fields directly).

---

## Testing

**Unit tests (TDD via `superpowers:test-driven-development`):**

- `lib/parsers/photo.ts` — fixture photos in `tests/fixtures/photos/` + `*.expected.json`. Assert shape and presence of brand/item-name, not exact strings. Marked `describe.skip` by default; run with `RUN_VISION_TESTS=1 npm test`. (Vision output is non-deterministic; running on every commit burns tokens for low signal.)
- `lib/dedup.ts` `fuzzyMatchExisting` — pure function. Cover exact match, case/whitespace variation, partial brand match, no-match, multiple matches.
- `apps/bot/commands/addgear.ts` — state machine with mocked `ConversationStore`, `PendingActionStore`, `sheets`, vision parser. Cover all transitions.

**Integration test:** one end-to-end test wiring real `ConversationStore` + `PendingActionStore` + mocked sheets + mocked vision, walking the happy path. Catches state-machine wiring bugs unit tests miss.

**Manual acceptance (before declaring done):**

- Photo of a known item → row appears in sheet with `Source = Image`, `Order ID = IMG-...`
- Duplicate of an email-ingested item → fuzzy match warns, cancel works
- Photo with no caption metadata → bot prompts for all missing fields serially
- `/cancel` mid-flow → state dropped, nothing written
- Simulated sheet-append failure → `retry` works without redoing the flow

**Not tested:** vision model drift over time (spot-checks during use are enough at this volume), Telegram API behavior (trusted dependency).

---

## Open questions / risks

- **Sheet dropdown edit is manual.** Tom needs to add `Image` to the `Source` column's data-validation values once. Document in the post-implementation acceptance checklist.
- **Vision cost.** Sonnet 4.6 vision is ~$3/M input tokens. A photo is roughly 1000–2000 tokens. At 5–20 items lifetime, total cost is negligible (< $1). No budget guardrails needed.
- **Caption parsing.** The caption `/addgear ~2018 ~$120` should pre-fill date and price *before* the bot prompts. Parsing free-text in captions is a small fuzziness — if it fails, the bot just falls through to prompting. Acceptable.
- **Existing-row marking is out of scope.** "Mark existing row N as 'I have this too'" was discussed and dropped — there's no schema for it (no quantity-owned column, no "verified" flag). Treat fuzzy-match acknowledgment as "add anyway" or "cancel" only in v1.

---

## Out of scope (future work)

- Other photo intents (`/trailid`, `/plantid`) — design preserves the photo channel for these but doesn't build them.
- Re-classifying photo rows from `Other` to a real domain after the fact (use existing reclassify script).
- Multi-image capture for one item (front + tag) — single photo is sufficient for current scope.
