import { load } from 'cheerio';
import type { ParsedItem, ParsedOrder } from './types.js';

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

    items.push({ itemName, quantity, price, productUrl, color, size });
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
