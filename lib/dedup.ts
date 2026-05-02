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
export interface DedupKeyInput {
  orderId: string;
  brand: string;
  itemName: string;
  color: string;
  size: string;
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
 * Per-row dedup index. Each existing row contributes:
 *   - Its full key (always) → exact-match lookups.
 *   - Its content key (only if Order ID is blank) → cross-match lookups,
 *     so a new fresh-email row can match a historical row with the same
 *     brand+name regardless of color/size formatting differences.
 */
export interface DedupIndex {
  fullKeys: Set<string>;
  blankOrderContentKeys: Set<string>;
}

export function buildExistingKeySet(rows: readonly DedupKeyInput[]): DedupIndex {
  const fullKeys = new Set<string>();
  const blankOrderContentKeys = new Set<string>();
  for (const r of rows) {
    fullKeys.add(makeDedupKey(r));
    if (!r.orderId.trim()) {
      blankOrderContentKeys.add(makeContentKey(r));
    }
  }
  return { fullKeys, blankOrderContentKeys };
}

export function dedupItems<T extends DedupKeyInput>(
  newItems: readonly T[],
  existing: DedupIndex,
): T[] {
  const seenInBatch = new Set<string>();
  const out: T[] = [];
  for (const item of newItems) {
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
    out.push(item);
  }
  return out;
}
