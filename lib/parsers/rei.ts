import { load } from 'cheerio';
import type { ParsedItem, ParsedOrder } from './types.js';

const SKU_IMG_SELECTOR = 'img[src*="rei.com/skuimage"]';
const ITEM_ID_REGEX = /Item\s*#\s*(\d{4,})/i;
const PRICE_REGEX = /\$([\d,]+(?:\.\d{2})?)/;
const STORE_REGEX = /Store\s*#:\s*(\d+)/i;
const TXN_REGEX = /Transaction\s*#:\s*(\d+)/i;

/**
 * REI in-store eReceipt parser. Triggered by `Transaction #` + `Items
 * purchased` markers in the body (REI does not send this format for online
 * orders, so this is a clean discriminator vs `parseReiEmail`).
 *
 * orderId is synthesized as `S{store}-T{txn}` to be unique across stores
 * while keeping the column visually distinct from online order IDs
 * (which are `A` + 8+ digits).
 *
 * The eReceipt does not include color/size, but it does include the
 * 6+-digit REI Item # — we synthesize `https://www.rei.com/product/<id>`
 * so dedup via `extractProductId` works the same as online orders.
 *
 * When the same product is rung up multiple times (consumables like
 * Clif bars), the eReceipt shows one line per scan. We aggregate by
 * Item # so the sheet gets one row with summed quantity.
 */
export function parseReiReceiptEmail(html: string): ParsedOrder | null {
  const $ = load(html);
  $('head, style, script').remove();
  const bodyText = $('body').text();

  const txnMatch = bodyText.match(TXN_REGEX);
  if (!txnMatch) return null;
  const storeMatch = bodyText.match(STORE_REGEX);
  if (!storeMatch) return null;
  if (!bodyText.includes('Items purchased')) return null;

  const orderId = `S${storeMatch[1]}-T${txnMatch[1]}`;

  const byProductId = new Map<string, ParsedItem>();

  $(SKU_IMG_SELECTOR).each((_, img) => {
    const $img = $(img);
    const itemName = ($img.attr('alt') ?? '').trim();
    if (!itemName) return;

    const itemBlock = $img.closest('div');
    const blockText = itemBlock.text();

    const itemIdMatch = blockText.match(ITEM_ID_REGEX);
    if (!itemIdMatch?.[1]) return;
    const itemId = itemIdMatch[1];

    const qtyMatch = blockText.match(/Qty:\s*(\d+)/i);
    const quantity = qtyMatch?.[1] ? parseInt(qtyMatch[1], 10) : 1;

    const priceMatch = blockText.match(PRICE_REGEX);
    const price = priceMatch?.[1] ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
    if (price <= 0) return;

    const productUrl = `https://www.rei.com/product/${itemId}`;
    const imageUrl = ($img.attr('src') ?? '').trim() || undefined;
    const existing = byProductId.get(itemId);
    if (existing) {
      existing.quantity += quantity;
      return;
    }
    byProductId.set(itemId, {
      itemName,
      quantity,
      price,
      productUrl,
      color: '',
      size: '',
      ...(imageUrl !== undefined ? { imageUrl } : {}),
    });
  });

  const items = [...byProductId.values()];
  if (items.length === 0) return null;

  return {
    source: 'REI',
    orderId,
    items,
  };
}

export function parseReiEmail(html: string): ParsedOrder | null {
  const $ = load(html);
  $('head, style, script').remove();
  const bodyText = $('body').text();
  const orderIdMatch = bodyText.match(/A\d{8,}/);
  if (!orderIdMatch) return null;

  const items: ParsedItem[] = [];
  $('img[src*="rei.com/skuimage"]').each((_, img) => {
    const $img = $(img);
    const itemName = ($img.attr('alt') ?? '').trim();
    if (!itemName) return;

    const table = $img.closest('table');
    const tableText = table.text();

    const qtyMatch = tableText.match(/Qty:\s*(\d+)/i);
    const quantity = qtyMatch?.[1] ? parseInt(qtyMatch[1], 10) : 1;

    const priceMatch = tableText.match(/\$([\d,]+(?:\.\d{2})?)/);
    const price = priceMatch?.[1] ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;

    const productAnchor = table
      .find('a')
      .filter((_, el) => $(el).text().trim() === itemName)
      .first();
    const productUrl = (productAnchor.attr('href') ?? '').trim();

    // Item-details row uses <p> tags in a stable order:
    // [0] = item name (already in alt), [1] = color, [2] = size, [last] = "Item #..."
    // Color/size may be empty (e.g. tents have no size; some items have no color).
    const detailsRow = table.find('tr').first();
    const detailParagraphs = detailsRow.find('p').toArray().map((p) => $(p).text().trim());
    const color = detailParagraphs[1] && !detailParagraphs[1].startsWith('Item #')
      ? detailParagraphs[1]
      : '';
    const size = detailParagraphs[2] && !detailParagraphs[2].startsWith('Item #')
      ? detailParagraphs[2]
      : '';

    const imageUrl = ($img.attr('src') ?? '').trim() || undefined;
    items.push({ itemName, quantity, price, productUrl, color, size, ...(imageUrl !== undefined ? { imageUrl } : {}) });
  });

  // Status / shipment / delivery emails sometimes include the product thumbnail
  // (same skuimage URL) but have no Qty/price info in the surrounding table —
  // so extracted items have price=0. Filter those out; they're not real
  // receipt line items.
  const realItems = items.filter((i) => i.price > 0);
  if (realItems.length === 0) return null;

  return {
    source: 'REI',
    orderId: orderIdMatch[0],
    items: realItems,
  };
}
