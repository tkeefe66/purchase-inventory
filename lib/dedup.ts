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
 * Token key — `(orderId, brand, first-3-content-tokens-after-brand-strip)`.
 * Catches the case where ONE side has a productUrl (so a strong key) and the
 * OTHER side doesn't (auto-confirm Haiku missed the URL), with item names
 * that drift in length but share a leading prefix. E.g. "HARIBO Goldbears,
 * Gummi Candy, 10 oz Resealable Bag" vs "HARIBO Goldbears, Gummi Candy, 10..."
 * both have first-3 tokens "goldbears gummi candy" → match.
 * Returns null when there aren't enough tokens to form a stable signature.
 */
export function makeTokenKey(input: DedupKeyInput): string | null {
  const orderId = input.orderId.trim();
  if (!orderId) return null;
  const tokens = firstNContentTokens(input.itemName, input.brand, 3);
  if (tokens.length < 3) return null;
  return `${orderId}||${input.brand.trim().toLowerCase()}||${tokens.join(' ')}`;
}

function firstNContentTokens(itemName: string, brand: string, n: number): string[] {
  const normalized = normalizeItemName(itemName, brand);
  // Strip non-alphanumeric so "Goldbears," and "Goldbears" tokenize identically.
  return normalized
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, n);
}

/**
 * Per-row dedup index. Each existing row contributes:
 *   - Its full key (always) → exact-match lookups.
 *   - Its content key (only if Order ID is blank) → cross-match lookups,
 *     so a new fresh-email row can match a historical row with the same
 *     brand+name regardless of color/size formatting differences.
 *   - Its strong key (when productUrl yields a productId AND orderId is
 *     present) → catches cross-source item-name drift within the same order.
 *   - Its token key (when orderId is present and itemName has ≥3 tokens) →
 *     last-resort cross-source match when one side lacks a productUrl.
 */
export interface DedupIndex {
  fullKeys: Set<string>;
  blankOrderContentKeys: Set<string>;
  strongKeys: Set<string>;
  tokenKeys: Set<string>;
}

export function buildExistingKeySet(rows: readonly DedupKeyInput[]): DedupIndex {
  const fullKeys = new Set<string>();
  const blankOrderContentKeys = new Set<string>();
  const strongKeys = new Set<string>();
  const tokenKeys = new Set<string>();
  for (const r of rows) {
    fullKeys.add(makeDedupKey(r));
    if (!r.orderId.trim()) {
      blankOrderContentKeys.add(makeContentKey(r));
    }
    const strong = makeStrongKey(r);
    if (strong) strongKeys.add(strong);
    const tok = makeTokenKey(r);
    if (tok) tokenKeys.add(tok);
  }
  return { fullKeys, blankOrderContentKeys, strongKeys, tokenKeys };
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
  image: string;
  orderId: string;
  productUrl: string;
}

export interface FuzzyCandidateRow {
  brand: string;
  itemName: string;
  image: string;
  orderId: string;
  productUrl: string;
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
      scored.push({
        rowIndex: idx,
        brand: row.brand,
        itemName: row.itemName,
        score,
        image: row.image,
        orderId: row.orderId,
        productUrl: row.productUrl,
      });
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
  const seenTokenInBatch = new Set<string>();
  const out: T[] = [];
  for (const item of newItems) {
    // Strong key first: (orderId, productId) survives item-name drift between
    // auto-confirm (Haiku) and shipment-tracking (IMG-alt) for the same order.
    const strongKey = makeStrongKey(item);
    if (strongKey) {
      if (existing.strongKeys.has(strongKey)) continue;
      if (seenStrongInBatch.has(strongKey)) continue;
    }
    // Token key: matches when ONE side has a productUrl and the OTHER doesn't,
    // but both share orderId + brand + first 3 content tokens. Catches the
    // auto-confirm-truncated-name case we saw 2026-05-15.
    const tokenKey = makeTokenKey(item);
    if (tokenKey) {
      if (existing.tokenKeys.has(tokenKey)) continue;
      if (seenTokenInBatch.has(tokenKey)) continue;
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
    if (tokenKey) seenTokenInBatch.add(tokenKey);
    out.push(item);
  }
  return out;
}
