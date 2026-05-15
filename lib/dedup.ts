/**
 * Per DECISIONS.md: dedup key is `(Order ID, Brand, Item Name, Color, Size)`.
 *
 * **Updated 2026-05-01** after discovering historical REI rows (from manual
 * data entry) carry the brand in a separate column and an item name without
 * the brand prefix, while parsers extract item names from `<img alt>` which
 * includes the brand. So `Brand="Salomon" / Item Name="X Ultra 5 Mid GORE-TEX
 * Hiking Boots - Men's"` (historical) and `Brand="Salomon" / Item Name=
 * "Salomon X Ultra 5 Mid GORE-TEX Hiking Boots - Men's"` (parsed from email)
 * are the same physical item but produced different dedup keys → duplicate
 * row. Fix:
 *
 * 1. Include `brand` in the key so brand+name are matched together.
 * 2. Normalize `itemName` (lowercase, trim, strip brand prefix if present)
 *    so "Salomon X Ultra…" and "X Ultra…" produce the same normalized form.
 * 3. **Wildcard Order ID match.** When a new item has an Order ID, also try
 *    matching against existing rows that have a *blank* Order ID with same
 *    brand+name+color+size. This catches the historical-REI-vs-fresh-email
 *    overlap (where Tom's manual REI rows have no Order ID).
 *
 * - Same item bought again in a different order is allowed (different Order ID
 *   → no exact match, AND no wildcard match because the existing row has its
 *   own Order ID populated).
 * - Same item shipping multiple times under the same Order ID is treated as a
 *   duplicate (key matches exactly).
 */
import { extractProductId } from './productId.js';

export interface DedupKeyInput {
  orderId: string;
  brand: string;
  itemName: string;
  color: string;
  size: string;
  /** Optional. When present, (orderId, productId) becomes the primary dedup
   *  key — bulletproof against item-name drift between auto-confirm
   *  (Haiku-extracted) and shipment (IMG-alt) emails for the same order. */
  productUrl?: string;
}

function normalizeItemName(itemName: string, brand: string): string {
  let normalized = itemName.trim().toLowerCase();
  const brandLower = brand.trim().toLowerCase();
  if (brandLower && normalized.startsWith(brandLower + ' ')) {
    normalized = normalized.slice(brandLower.length + 1);
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

/**
 * Full key — used for exact same-order matches (so e.g. buying two color
 * variants of the same item in one order stays as two distinct rows).
 */
export function makeDedupKey(input: DedupKeyInput): string {
  return [
    input.orderId.trim(),
    input.brand.trim().toLowerCase(),
    normalizeItemName(input.itemName, input.brand),
    input.color.trim().toLowerCase(),
    input.size.trim().toLowerCase(),
  ].join('||');
}

/**
 * Content key — used for cross-matching historical (no Order ID) rows against
 * fresh-from-email rows. Uses brand + normalized name only — IGNORES color
 * and size — because manual historical data and email-parsed data often have
 * minor formatting differences in those fields (e.g. "Black/Asphalt/Castlerock"
 * from REI's catalog vs "Black/Asphalt" from the order email). The trade-off:
 * if Tom historically bought item X in size 9 (manually entered with no Order
 * ID) and later buys the same item in size 11 (with an Order ID from email),
 * the new purchase will be wrongly considered a duplicate. That edge case is
 * rare; manual override in the sheet is the workaround. The common case
 * (historical no-Order-ID row shadowing fresh email) is much more frequent
 * and worth optimizing for.
 */
export function makeContentKey(input: { brand: string; itemName: string }): string {
  return [
    input.brand.trim().toLowerCase(),
    normalizeItemName(input.itemName, input.brand),
  ].join('||');
}

/**
 * Strong key — `(orderId, productId)` where productId is the ASIN (Amazon)
 * or numeric product ID (REI) extracted from `productUrl`. This survives
 * item-name drift between auto-confirm and shipment-tracking emails for the
 * same order. Returns null when either side is missing.
 */
export function makeStrongKey(input: DedupKeyInput): string | null {
  const orderId = input.orderId.trim();
  if (!orderId) return null;
  const pid = extractProductId(input.productUrl ?? '');
  if (!pid) return null;
  return `${orderId}||${pid}`;
}

/**
 * Per-row dedup index. Each existing row contributes:
 *   - Its full key (always) → exact-match lookups.
 *   - Its content key (only if Order ID is blank) → cross-match lookups,
 *     so a new fresh-email row can match a historical row with the same
 *     brand+name regardless of color/size formatting differences.
 *   - Its strong key (when productUrl yields a productId AND orderId is
 *     present) → catches cross-source item-name drift within the same order.
 */
export interface DedupIndex {
  fullKeys: Set<string>;
  blankOrderContentKeys: Set<string>;
  strongKeys: Set<string>;
}

export function buildExistingKeySet(rows: readonly DedupKeyInput[]): DedupIndex {
  const fullKeys = new Set<string>();
  const blankOrderContentKeys = new Set<string>();
  const strongKeys = new Set<string>();
  for (const r of rows) {
    fullKeys.add(makeDedupKey(r));
    if (!r.orderId.trim()) {
      blankOrderContentKeys.add(makeContentKey(r));
    }
    const strong = makeStrongKey(r);
    if (strong) strongKeys.add(strong);
  }
  return { fullKeys, blankOrderContentKeys, strongKeys };
}

// ---------------------------------------------------------------------------
// Fuzzy match — used by /addgear to warn before writing a likely duplicate.
// ---------------------------------------------------------------------------

/**
 * Used by /addgear flow to warn before writing a duplicate. Returns the top
 * 3 existing rows with score >= 0.5 ranked by token-overlap (Jaccard).
 *
 * Score is Jaccard over the token set of (normalizedBrand + normalizedItemName).
 * Normalization: lowercase, trim, collapse internal whitespace.
 */
export interface FuzzyMatch {
  rowIndex: number;
  brand: string;
  itemName: string;
  score: number;
}

export interface FuzzyCandidateRow {
  brand: string;
  itemName: string;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().trim().split(/\s+/).filter((t) => t.length > 0),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function fuzzyMatchExisting(
  brand: string,
  itemName: string,
  rows: readonly FuzzyCandidateRow[],
): FuzzyMatch[] {
  const target = tokenize(`${brand} ${itemName}`);
  const scored: FuzzyMatch[] = [];
  rows.forEach((row, idx) => {
    const candidate = tokenize(`${row.brand} ${row.itemName}`);
    const score = jaccard(target, candidate);
    if (score >= 0.5) {
      scored.push({ rowIndex: idx, brand: row.brand, itemName: row.itemName, score });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Standard dedup — used by the ingest pipeline.
// ---------------------------------------------------------------------------

export function dedupItems<T extends DedupKeyInput>(
  newItems: readonly T[],
  existing: DedupIndex,
): T[] {
  const seenInBatch = new Set<string>();
  const seenStrongInBatch = new Set<string>();
  const out: T[] = [];
  for (const item of newItems) {
    // Strong key first: (orderId, productId) survives item-name drift between
    // auto-confirm (Haiku) and shipment-tracking (IMG-alt) for the same order.
    const strongKey = makeStrongKey(item);
    if (strongKey) {
      if (existing.strongKeys.has(strongKey)) continue;
      if (seenStrongInBatch.has(strongKey)) continue;
    }
    const exactKey = makeDedupKey(item);
    if (existing.fullKeys.has(exactKey)) continue;
    if (seenInBatch.has(exactKey)) continue;
    // Cross-match: new item with a real Order ID matches an existing
    // historical (blank-Order-ID) row by brand+name content key — tolerant
    // of color/size formatting differences between manual entry and email.
    if (item.orderId.trim()) {
      const contentKey = makeContentKey(item);
      if (existing.blankOrderContentKeys.has(contentKey)) continue;
    }
    seenInBatch.add(exactKey);
    if (strongKey) seenStrongInBatch.add(strongKey);
    out.push(item);
  }
  return out;
}
