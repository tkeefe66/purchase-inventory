import { load } from 'cheerio';
import type { ParsedItem, ParsedOrder } from './types.js';

const ORDER_ID_REGEX = /\b\d{3}-\d{7}-\d{7}\b/g;

// Amazon prices in shipment emails are styled as a typographic group:
//   <sup>$</sup> <span>1,498</span> <sup>00</sup>
// (separated by table cells / whitespace). Reassemble dollars + cents.
const TYPOGRAPHIC_PRICE_REGEX =
  /<sup[^>]*>\$<\/sup>[\s\S]{0,200}?<span[^>]*>([\d,]+)<\/span>[\s\S]{0,100}?<sup[^>]*>(\d{2})<\/sup>/gi;

// Boundary phrases that mark the start of recommendations / advertisements.
// Truncating the HTML here prevents the parser from mistaking ads for ordered items.
const RECOMMENDATION_BOUNDARY_REGEX =
  /Continue shopping deals|Related to items you[' ]?ve viewed|You might also like|Deals related to your purchases|Top picks for you|Customers also bought|Recommended for you/i;

// Order-confirmation emails ("Ordered: …") only show the order total, not
// per-item prices. We don't ingest from those — we wait for the shipment
// notification. See DECISIONS.md (2026-05-01: "Amazon parser sources
// shipment-tracking only").
function isShipmentEmail(bodyText: string): boolean {
  return /package\s+was\s+shipped/i.test(bodyText);
}

function truncateAtRecommendations(html: string): string {
  const match = html.match(RECOMMENDATION_BOUNDARY_REGEX);
  if (match?.index !== undefined) return html.slice(0, match.index);
  return html;
}

export function parseAmazonEmail(html: string): ParsedOrder[] | null {
  const $fullDoc = load(html);
  $fullDoc('head, style, script').remove();
  const fullBodyText = $fullDoc('body').text();

  if (!isShipmentEmail(fullBodyText)) return null;

  const orderIds = [...new Set(fullBodyText.match(ORDER_ID_REGEX) ?? [])];
  if (orderIds.length === 0) return null;

  const truncatedHtml = truncateAtRecommendations(html);
  const $ = load(truncatedHtml);
  $('head, style, script').remove();

  const productImages: Array<{ alt: string; url: string }> = [];
  $('img[alt]').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    if (alt.length < 30) return;
    if (alt.toLowerCase().includes('amazon.com')) return;
    const url = ($(el).closest('a').attr('href') ?? '').trim();
    productImages.push({ alt, url });
  });

  if (productImages.length === 0) return null;

  const prices: number[] = [];
  let priceMatch: RegExpExecArray | null;
  TYPOGRAPHIC_PRICE_REGEX.lastIndex = 0;
  while ((priceMatch = TYPOGRAPHIC_PRICE_REGEX.exec(truncatedHtml)) !== null) {
    const dollars = (priceMatch[1] ?? '').replace(/,/g, '');
    const cents = priceMatch[2] ?? '00';
    prices.push(parseFloat(`${dollars}.${cents}`));
  }

  const truncatedText = $('body').text();
  const qtyMatches = [...truncatedText.matchAll(/Quantity:\s*(\d+)/gi)];

  const items: ParsedItem[] = productImages
    .map((p, i) => ({
      itemName: p.alt,
      quantity: qtyMatches[i]?.[1] ? parseInt(qtyMatches[i]![1]!, 10) : 1,
      price: prices[i] ?? 0,
      productUrl: p.url,
    }))
    // Real ordered items always have a price extracted via the typographic
    // pattern. Recommendation/ad items use a different markup (plain "$X.XX")
    // that the typographic regex doesn't match → price=0. Filter them out as
    // a safety net in case the boundary truncation didn't catch the section.
    .filter((item) => item.price > 0);

  if (items.length === 0) return null;

  // Multi-Order-ID emails: for now, put all items under the first Order ID.
  // Real multi-order shipment fixtures will need section-based assignment.
  return orderIds.map((orderId, idx) => ({
    source: 'Amazon' as const,
    orderId,
    items: idx === 0 ? items : [],
  }));
}
