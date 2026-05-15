/**
 * Extract a stable product identifier from a product URL. Used by dedup so
 * an auto-confirm row (Haiku-extracted item name) and a shipment row (IMG-alt
 * item name) match each other even when their displayed names drift.
 *
 * Returns a namespaced string ("amzn:<ASIN>", "rei:<id>") to prevent
 * cross-retailer collisions, or null when no recognized pattern matches.
 */
export function extractProductId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Amazon ASIN — 10 chars, mix of digits + uppercase letters.
  // Covers: /dp/B0XXX, /gp/product/B0XXX, /gp/aw/d/B0XXX, /product/B0XXX
  const amzn = trimmed.match(
    /amazon\.[a-z.]+\/(?:[^/]+\/)?(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})\b/i,
  );
  if (amzn) return `amzn:${amzn[1]!.toUpperCase()}`;

  // REI product page — numeric ID after /product/.
  const rei = trimmed.match(/rei\.com\/(?:[a-z-]+\/)?product\/(\d+)/i);
  if (rei) return `rei:${rei[1]!}`;

  return null;
}
