import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../anthropic-retry.js';
import { MODELS } from '../models.js';
import type { ParsedItem } from './types.js';

export interface ReceiptLookupResult {
  brand: string;
  itemName: string;
  color: string;
  size: string;
}

const SYSTEM_PROMPT = `You enrich a single REI in-store purchase record.

You will be given a partial purchase from a customer's eReceipt: a synthesized REI product URL (rei.com/product/<numeric-id>), the abbreviated POS register name (often a short or CamelCase fragment, sometimes with strange spacing), and the price paid.

Your job: find the REI product page (or a major-retailer listing if REI is unreachable) and extract the canonical product details.

Use web_search (up to 2 searches) — prefer queries like "site:rei.com <numeric-id>" or "<abbreviated-name> REI". The product URL's numeric ID is the most reliable signal; the abbreviation is noisy.

Return JSON only:
{"brand": "<manufacturer>", "itemName": "<canonical product name with brand prefix STRIPPED>", "color": "<color if discoverable, else empty>", "size": "<size if discoverable, else empty>"}

Rules:
- brand: the manufacturer (e.g., "Smith", "Patagonia", "REI Co-op"). Empty string if you can't determine it confidently.
- itemName: the full marketing name. STRIP the brand prefix (we store brand separately). Example: "Charger MIPS Snow Helmet" (not "Smith Charger MIPS Snow Helmet").
- color, size: the eReceipt didn't capture which variant the customer bought, so leave these EMPTY unless the product is a single-variant SKU.
- If you cannot find a confident match, return {"brand": "", "itemName": "", "color": "", "size": ""}.
- Return JSON only — no prose, no markdown fences.`;

/**
 * Sonnet + web_search lookup for a single eReceipt line item. Returns null on
 * any error or when no confident match was found. Anthropic's commercial
 * search infrastructure handles the REI Cloudflare block that defeats direct
 * fetches — verified 2026-05-17.
 */
export async function lookupReceiptItem(
  anthropic: Anthropic,
  item: ParsedItem,
): Promise<ReceiptLookupResult | null> {
  const userText = `URL: ${item.productUrl}\nPOS abbreviation: ${item.itemName}\nPrice paid: $${item.price.toFixed(2)}`;

  let resp: Anthropic.Messages.Message;
  try {
    resp = await callWithRetry(() =>
      anthropic.messages.create({
        model: MODELS.sonnet,
        max_tokens: 512,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userText }],
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 2,
          },
        ] as unknown as Anthropic.Messages.Tool[],
      }),
    );
  } catch (err) {
    console.warn(
      `[rei-product-lookup] Sonnet call failed for ${item.productUrl}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return null;
  }

  const textBlocks = resp.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) return null;

  const cleaned = extractJsonObject(lastText.text);
  if (!cleaned) return null;

  let parsed: { brand?: unknown; itemName?: unknown; color?: unknown; size?: unknown };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return null;
  }

  const brand = typeof parsed.brand === 'string' ? parsed.brand : '';
  const itemName = typeof parsed.itemName === 'string' ? parsed.itemName : '';
  const color = typeof parsed.color === 'string' ? parsed.color : '';
  const size = typeof parsed.size === 'string' ? parsed.size : '';
  if (!brand && !itemName) return null;
  return { brand, itemName, color, size };
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
