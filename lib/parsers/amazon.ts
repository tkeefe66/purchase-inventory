import { load } from 'cheerio';
import type Anthropic from '@anthropic-ai/sdk';
import { PARSER_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';
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

function isShipmentEmail(bodyText: string): boolean {
  return /package\s+was\s+shipped/i.test(bodyText);
}

/**
 * Detect "Ordered: …" auto-confirm emails. These were originally skipped
 * (DECISIONS.md 2026-05-01) because the shipment email carries cleaner
 * per-item prices, but skipping them means a 1–3 day delay before a purchase
 * shows up in the sheet. We now parse them with Haiku so the row appears
 * immediately; the shipment email arriving later dedups against the same
 * (orderId, brand, itemName, color, size) tuple.
 */
function isOrderConfirmEmail(bodyText: string): boolean {
  return /\bthanks?\s+for\s+your\s+order\b/i.test(bodyText)
    || /\border\s+confirmation\b/i.test(bodyText)
    || /\byour\s+order\s+is\s+confirmed\b/i.test(bodyText);
}

function truncateAtRecommendations(html: string): string {
  const match = html.match(RECOMMENDATION_BOUNDARY_REGEX);
  if (match?.index !== undefined) return html.slice(0, match.index);
  return html;
}

export function parseAmazonShipmentEmail(html: string): ParsedOrder[] | null {
  const $fullDoc = load(html);
  $fullDoc('head, style, script').remove();
  const fullBodyText = $fullDoc('body').text();

  if (!isShipmentEmail(fullBodyText)) return null;

  const orderIds = [...new Set(fullBodyText.match(ORDER_ID_REGEX) ?? [])];
  if (orderIds.length === 0) return null;

  const truncatedHtml = truncateAtRecommendations(html);
  const $ = load(truncatedHtml);
  $('head, style, script').remove();

  const productImages: Array<{ alt: string; url: string; imageUrl?: string }> = [];
  $('img[alt]').each((_, el) => {
    const alt = ($(el).attr('alt') ?? '').trim();
    if (alt.length < 30) return;
    if (alt.toLowerCase().includes('amazon.com')) return;
    const url = ($(el).closest('a').attr('href') ?? '').trim();
    const src = $(el).attr('src')?.trim() || undefined;
    productImages.push({ alt, url, imageUrl: src });
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
      imageUrl: p.imageUrl,
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

const ORDER_EMAIL_SYSTEM_PROMPT = `You extract per-line-item product info from an Amazon "Ordered:" auto-confirm email.

Return JSON only:
{
  "orderId": "<the Order # in 113-1234567-1234567 format, or empty>",
  "items": [
    {
      "itemName": "<full product title>",
      "quantity": <integer, default 1>,
      "price": <per-item paid price in USD AFTER discounts, or 0 if not visible>,
      "productUrl": "<canonical amazon.com product URL, or empty>"
    }
  ]
}

Rules:
- One entry per LINE ITEM. Quantity-2 of the same product is ONE entry with quantity=2.
- Exclude shipping, tax, gift wrap, gift cards, subscribe-and-save fees, and any "Recommended for you" / "Customers also bought" / "Sponsored" items.
- price = per-item PAID price (not subtotal, not order total). If only an order total is shown, set price to 0 — do not divide.
- itemName MUST be the FULL product title pulled from the order-summary section of the email body — NOT the email's subject-line preview, which is truncated by Amazon. The body always contains the complete title near the price/quantity. If you can only find a truncated version (ends with "…", "...", or cut off mid-word), SKIP that item entirely rather than emit a partial title.
- productUrl = the amazon.com/dp/<ASIN> or amazon.com/gp/product/<ASIN> link. The email body always contains a per-item link near the title — find it. Strip tracking query params (everything after a /dp/<ASIN> or /gp/product/<ASIN> path is OK to drop).
- If you can't find a productUrl for an item, SKIP that item entirely (better to miss it and let the shipment-tracking email catch it later than to write a row without an ASIN).
- Return JSON only, no prose, no markdown fences.`;

/**
 * Parse an Amazon "Ordered:" auto-confirm email using Haiku. We hit Haiku
 * because the order-email HTML varies enough between cart shapes (single
 * item, "and N more items", Subscribe & Save, gift orders) that pure cheerio
 * regularly miscounts or grabs the order total instead of per-item prices.
 *
 * Returns null if the email doesn't look like an order confirmation or if
 * Haiku can't extract anything usable.
 */
export async function parseAmazonOrderEmail(
  anthropic: Anthropic,
  html: string,
): Promise<ParsedOrder[] | null> {
  const $ = load(html);
  $('head, style, script').remove();
  const bodyText = cleanBodyText($('body').text());
  if (!isOrderConfirmEmail(bodyText)) return null;

  const orderIds = [...new Set(bodyText.match(ORDER_ID_REGEX) ?? [])];
  if (orderIds.length === 0) return null;

  // Truncate at recommendations and chop preview-padding garbage out so the
  // prompt is small and focused on the actual order summary.
  const truncatedText = truncateAtRecommendations(bodyText).slice(0, 12000);

  let resp: Anthropic.Messages.Message;
  try {
    resp = await callWithRetry(() =>
      anthropic.messages.create({
        model: PARSER_MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: ORDER_EMAIL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: truncatedText }],
      }),
    );
  } catch (err) {
    console.warn(`[amazon] parseAmazonOrderEmail Haiku call failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!textBlock) return null;

  const cleaned = extractJsonObject(textBlock.text);
  if (!cleaned) {
    console.warn(`[amazon] parseAmazonOrderEmail: could not isolate JSON in response: ${textBlock.text.slice(0, 200)}`);
    return null;
  }

  let parsed: { orderId?: unknown; items?: unknown };
  try { parsed = JSON.parse(cleaned) as typeof parsed; }
  catch (err) {
    console.warn(`[amazon] parseAmazonOrderEmail: JSON.parse failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;

  const items: ParsedItem[] = parsed.items
    .filter((it): it is { itemName: string; quantity?: unknown; price?: unknown; productUrl?: unknown } =>
      typeof it === 'object' && it !== null
      && typeof (it as Record<string, unknown>).itemName === 'string'
      && ((it as Record<string, unknown>).itemName as string).trim().length > 0,
    )
    .map((it) => ({
      itemName: (it.itemName as string).trim(),
      quantity: Number.isFinite(it.quantity) && (it.quantity as number) > 0 ? Math.floor(it.quantity as number) : 1,
      price: Number.isFinite(it.price) && (it.price as number) >= 0 ? (it.price as number) : 0,
      productUrl: typeof it.productUrl === 'string' ? it.productUrl.trim() : '',
    }))
    // Reject items where Haiku grabbed a truncated subject-preview title or
    // couldn't find a productUrl. Without the ASIN, dedup falls back to fuzzy
    // name matching against the eventual shipment-tracking row — which we've
    // observed produces duplicate rows (2026-05-15). Skipping here lets the
    // shipment-tracking parser ingest the item cleanly when it arrives.
    .filter((it) => !looksTruncatedOrderItem(it.itemName) && it.productUrl.length > 0);

  if (items.length === 0) return null;

  // Prefer the orderId Haiku returned (it knows which one was the customer's
  // Order # vs a referenced "previous order"), fall back to the first one
  // we regex-scraped.
  const responseOrderId = typeof parsed.orderId === 'string' ? parsed.orderId.trim() : '';
  const isValidOrderId = (id: string): boolean => /^\d{3}-\d{7}-\d{7}$/.test(id);
  const orderId = isValidOrderId(responseOrderId) ? responseOrderId : (orderIds[0] ?? '');
  if (!orderId) return null;

  return [{ source: 'Amazon' as const, orderId, items }];
}

/**
 * Detect Haiku output that grabbed Amazon's truncated subject-preview title.
 * Conservative — only flags obvious cases (trailing ellipsis, empty). The
 * real safety net is the required-productUrl filter in parseAmazonOrderEmail:
 * if there's no ASIN, the row gets dropped no matter how the name looks.
 * Trying to detect chopped-mid-word names heuristically produced too many
 * false positives (legit "Fl Oz", "V3", "IV" endings) — not worth it.
 */
export function looksTruncatedOrderItem(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return /(?:\.{2,}|…)$/.test(trimmed);
}

/** Strip Amazon's preview-padding zero-width characters so Haiku doesn't waste tokens on them. */
function cleanBodyText(text: string): string {
  return text
    .replace(/[\u00AD\u034F\u200B-\u200D\u2007\u2060\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
