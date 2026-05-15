import { load } from 'cheerio';
import type Anthropic from '@anthropic-ai/sdk';
import { PARSER_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';

export interface ReturnAction {
  /** Amazon Order ID (113-XXX-XXX). Required — we won't act without it. */
  orderId: string;
  items: ReturnActionItem[];
}

export interface ReturnActionItem {
  itemName: string;
  productUrl: string;
}

const ORDER_ID_REGEX = /\b\d{3}-\d{7}-\d{7}\b/;

const SYSTEM_PROMPT = `You extract structured info from an Amazon return-related email (return@amazon.com).

These emails come in flavors: "Refund issued", "Dropoff confirmed", "Return received", "Return requested". For ALL of them, the customer has initiated or completed a return of an item that was previously purchased.

Return JSON only:
{
  "orderId": "<the Amazon Order # in 113-1234567-1234567 format, or empty>",
  "items": [
    {
      "itemName": "<the product title being returned>",
      "productUrl": "<canonical amazon.com product URL if visible, or empty>"
    }
  ]
}

Rules:
- Most return emails reference ONE item. If multiple items are listed, return all of them.
- orderId: scrape from the visible "Order #" or "Order ID" text in the email body.
- itemName: the product title as displayed.
- productUrl: the amazon.com/dp/<ASIN> or amazon.com/gp/product/<ASIN> link if visible.
- Return JSON only, no prose, no markdown fences.`;

/**
 * Parse an Amazon return/refund email. Used by the cron pipeline to flip
 * matching sheet rows to Status='returned'. Returns null if the email
 * doesn't yield an Order ID + at least one item — without those we can't
 * confidently match a row to update.
 */
export async function parseAmazonReturnEmail(
  anthropic: Anthropic,
  html: string,
): Promise<ReturnAction | null> {
  const $ = load(html);
  $('head, style, script').remove();
  const bodyText = cleanBodyText($('body').text()).slice(0, 8000);
  if (!bodyText) return null;

  let resp: Anthropic.Messages.Message;
  try {
    resp = await callWithRetry(() =>
      anthropic.messages.create({
        model: PARSER_MODEL,
        max_tokens: 512,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: bodyText }],
      }),
    );
  } catch (err) {
    console.warn(`[amazon-return] Haiku call failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  const block = resp.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) return null;

  const cleaned = extractJsonObject(block.text);
  if (!cleaned) return null;

  let parsed: { orderId?: unknown; items?: unknown };
  try { parsed = JSON.parse(cleaned) as typeof parsed; }
  catch { return null; }

  const haikuOrderId = typeof parsed.orderId === 'string' ? parsed.orderId.trim() : '';
  const orderId = ORDER_ID_REGEX.test(haikuOrderId)
    ? haikuOrderId
    : (bodyText.match(ORDER_ID_REGEX)?.[0] ?? '');
  if (!orderId) return null;

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;
  const items: ReturnActionItem[] = parsed.items
    .filter((it): it is { itemName: string; productUrl?: unknown } =>
      typeof it === 'object' && it !== null
      && typeof (it as Record<string, unknown>).itemName === 'string'
      && ((it as Record<string, unknown>).itemName as string).trim().length > 0,
    )
    .map((it) => ({
      itemName: (it.itemName as string).trim(),
      productUrl: typeof it.productUrl === 'string' ? it.productUrl.trim() : '',
    }));

  if (items.length === 0) return null;
  return { orderId, items };
}

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
