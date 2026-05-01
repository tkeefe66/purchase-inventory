export type Source = 'REI' | 'Amazon';

/**
 * Builds a synthesized "good enough" product URL when the real one couldn't
 * be extracted from the source (e.g. historical-import rows, or Amazon
 * shipment emails that don't include a per-line product link).
 *
 * Rules:
 *   - Amazon + order ID → order-detail URL (lands on the order page when logged in)
 *   - Amazon w/o order ID → Amazon search by item name
 *   - REI → REI search by item name (REI's catalog is small enough that name-search lands on the right product ~90% of the time)
 *
 * Used by:
 *   - scripts/backfill-urls.ts (one-time historical backfill)
 *   - scripts/migrate-to-master.ts (future re-migrations)
 *   - lib/parsers/{rei,amazon}.ts (Phase 1, when an email doesn't carry a product URL)
 */
export function buildFallbackProductUrl(args: {
  source: Source;
  orderId?: string | undefined;
  itemName: string;
}): string {
  const { source, orderId, itemName } = args;
  const trimmedItem = itemName.trim();
  if (!trimmedItem) return '';

  if (source === 'Amazon') {
    if (orderId && orderId.trim()) {
      return `https://www.amazon.com/gp/your-account/order-details?orderID=${encodeURIComponent(orderId.trim())}`;
    }
    return `https://www.amazon.com/s?k=${encodeURIComponent(trimmedItem)}`;
  }

  if (source === 'REI') {
    return `https://www.rei.com/search?q=${encodeURIComponent(trimmedItem)}`;
  }

  return '';
}
