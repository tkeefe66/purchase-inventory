/**
 * Per DECISIONS.md: dedup key is `(Order ID, Item Name, Color, Size)`.
 *
 * - Same item bought again in a different order is allowed (different Order ID).
 * - Same item in same order twice with same color/size is not (duplicate).
 * - For historical REI rows that have blank Order IDs, the key collapses to
 *   `||ItemName|Color|Size` and dedups against itself by content. New REI rows
 *   ingested via Phase 1 cron will always have Order IDs from the email.
 */
export interface DedupKeyInput {
  orderId: string;
  itemName: string;
  color: string;
  size: string;
}

export function makeDedupKey(input: DedupKeyInput): string {
  return [
    input.orderId.trim(),
    input.itemName.trim(),
    input.color.trim(),
    input.size.trim(),
  ].join('||');
}

export function dedupItems<T extends DedupKeyInput>(
  newItems: readonly T[],
  existingKeys: ReadonlySet<string>,
): T[] {
  const seenInBatch = new Set<string>();
  const out: T[] = [];
  for (const item of newItems) {
    const key = makeDedupKey(item);
    if (existingKeys.has(key)) continue;
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    out.push(item);
  }
  return out;
}
