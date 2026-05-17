import type Anthropic from '@anthropic-ai/sdk';
import { lookupReceiptItem } from './rei-product-lookup.js';
import type { ParsedItem } from './types.js';

const CONCURRENCY = 3;

/**
 * REI in-store eReceipts give us the POS register's abbreviated product code
 * via `<img alt>` ("Renegade Recon", "CompressiblePillow", "LoungerDLChairMesh") —
 * not the real marketing name. The classifier downstream then gets garbage
 * inputs and produces garbage brand/domain/category guesses.
 *
 * We can't use a direct fetch path because REI's Cloudflare hard-blocks
 * non-browser User-Agents (verified 2026-05-17). Instead this delegates to
 * `lookupReceiptItem`, which uses Sonnet + web_search over Anthropic's
 * commercial search infrastructure.
 *
 * Falls back to the raw parsed item if the lookup returns null or empty —
 * we'd rather keep a bad name than silently drop a real purchase.
 *
 * Only used for in-store eReceipts; online REI orders already carry clean
 * `<img alt>` text and proper product URLs in their order-confirm HTML.
 */
export async function enrichReiReceiptItems(
  items: readonly ParsedItem[],
  anthropic: Anthropic,
): Promise<ParsedItem[]> {
  const out: ParsedItem[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const enriched = await Promise.all(batch.map((item) => enrichOne(item, anthropic)));
    out.push(...enriched);
  }
  return out;
}

async function enrichOne(item: ParsedItem, anthropic: Anthropic): Promise<ParsedItem> {
  try {
    const info = await lookupReceiptItem(anthropic, item);
    if (!info) return item;
    const itemName = info.itemName.trim() || item.itemName;
    const brand = info.brand.trim() || item.brand || '';
    const color = info.color.trim() || item.color || '';
    const size = info.size.trim() || item.size || '';
    if (
      itemName === item.itemName &&
      brand === (item.brand ?? '') &&
      color === (item.color ?? '') &&
      size === (item.size ?? '')
    ) {
      return item;
    }
    return { ...item, itemName, brand, color, size };
  } catch (err) {
    console.warn(
      `[rei-receipt-enrich] enrichment failed for ${item.productUrl}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return item;
  }
}
