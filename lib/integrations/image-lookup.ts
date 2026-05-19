import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../anthropic-retry.js';
import { MODELS } from '../models.js';

export interface ProductIdentity {
  brand: string;
  itemName: string;
  productUrl: string;
}

const SYSTEM_PROMPT = `You find the canonical product image URL for a piece of consumer gear.

You will be given: brand, itemName, and optionally a productUrl (may be Amazon, REI, or empty).

Your job: find ONE high-quality product image URL that represents the item. Prefer the retailer's CDN (m.media-amazon.com, images.rei.com, the manufacturer's own CDN). Avoid lifestyle/banner images; prefer studio shots on white background.

Use web_search (up to 2 searches). Prefer queries like "<brand> <itemName> product image" or "site:rei.com <itemName>".

Return JSON only:
{"imageUrl": "<absolute https URL, or empty string if no confident match>"}

Rules:
- The URL must end with a common image extension (.jpg, .jpeg, .png, .webp) OR clearly be a CDN image URL.
- If you cannot find a confident match, return {"imageUrl": ""}.
- Return JSON only — no prose, no markdown fences.`;

export async function lookupProductImageUrl(
  anthropic: Anthropic,
  identity: ProductIdentity,
): Promise<string | null> {
  const userText = `brand: ${identity.brand}\nitemName: ${identity.itemName}\nproductUrl: ${identity.productUrl || '(none)'}`;

  let resp: Anthropic.Messages.Message;
  try {
    resp = await callWithRetry(() =>
      anthropic.messages.create({
        model: MODELS.sonnet,
        max_tokens: 256,
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
      `[image-lookup] Sonnet call failed for ${identity.brand} ${identity.itemName}: ${
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

  let parsed: { imageUrl?: unknown };
  try {
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch {
    return null;
  }

  const url = typeof parsed.imageUrl === 'string' ? parsed.imageUrl.trim() : '';
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
