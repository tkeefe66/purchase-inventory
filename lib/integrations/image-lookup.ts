import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../anthropic-retry.js';
import { MODELS } from '../models.js';

export interface ProductIdentity {
  brand: string;
  itemName: string;
  productUrl: string;
}

/**
 * Hosts we reject post-hoc, even if Sonnet returns them. These are aggregators,
 * review/social sites, marketplaces, and image-search shells where the URL
 * tends to be hotlinked, broken, or a thumbnail that 4xx's when fetched.
 */
const BLOCKED_IMAGE_HOSTS = new Set([
  'pinimg.com',
  'pinterest.com',
  'i.pinimg.com',
  'etsy.com',
  'i.etsystatic.com',
  'reddit.com',
  'redd.it',
  'i.redd.it',
  'imgur.com',
  'i.imgur.com',
  'instagram.com',
  'cdninstagram.com',
  'tiktok.com',
  'ebay.com',
  'i.ebayimg.com',
  'mercari.com',
  'poshmark.com',
  'facebook.com',
  'fbcdn.net',
  'lookaside.fbsbx.com',
  'google.com',
  'gstatic.com',
  'bing.com',
  'duckduckgo.com',
]);

const SYSTEM_PROMPT = `You find the canonical product image URL for a piece of outdoor / lifestyle gear for a personal inventory dashboard.

INPUTS: brand, itemName, optionally a productUrl.

GOAL: return ONE high-quality, studio-style product photo (white or neutral background, clean crop) hosted on a real product/retailer CDN. NOT a lifestyle scene, NOT a user-generated photo, NOT a third-party aggregator thumbnail.

PREFERRED IMAGE HOSTS (try in this order):
1. The brand's own product CDN — e.g. patagonia.com, blackdiamondequipment.com, smartwool.com, darntough.com, kuiu.com, marmot.com, arcteryx.com, salomon.com, mec.ca, osprey.com.
2. m.media-amazon.com — Amazon's image CDN (paths like /images/I/<id>.jpg). Reliable for items sold on Amazon.
3. www.rei.com/media/product/<id> — REI's product image endpoint. Use for any REI Co-op or REI-stocked brand.
4. content.backcountry.com or images.backcountry.com — Backcountry's CDN. Common for ski / climb / hike apparel.
5. images.evo.com — evo.com's CDN. Strong for skis, snowboards, climbing gear.
6. llbean.com (/is/image/LLBean/...) — for L.L.Bean items.
7. Any other obvious manufacturer CDN — only if the brand has one. Better than a 3rd-party host.

NEVER RETURN URLs FROM:
- Pinterest, Etsy, Reddit, Imgur, Instagram, TikTok, Facebook (any user-generated host)
- eBay, Mercari, Poshmark, Facebook Marketplace (used-goods marketplaces)
- Google Images / Bing Images / DuckDuckGo (search-engine wrappers, not the actual image source)
- Blog posts, review sites, generic SEO content — even if they embed a product image
- Wikipedia, Wikimedia (rarely product shots)

SEARCH STRATEGY (up to 4 web_search calls):
1. Start with a brand-site query: '<brand> <itemName> site:<likely-brand-domain>'.
2. If brand is "REI Co-op" or item is clearly REI-stocked: '<itemName> site:rei.com'.
3. If brand likely sells on Amazon: '<brand> <itemName> amazon' — pick a result whose image is on m.media-amazon.com.
4. If brand is a niche outdoor maker (Backcountry / evo brands): try 'site:backcountry.com' or 'site:evo.com'.
5. If still nothing: do one broad '<brand> <itemName> product photo' search, then choose only from a preferred host above.

VALIDATION (apply before returning):
- URL must be absolute https.
- URL must clearly come from a real product CDN (the preferred list, or an obvious brand-owned cdn.<brand>.com / images.<brand>.com).
- URL should end with .jpg/.jpeg/.png/.webp, OR be a known dynamic-path CDN endpoint (e.g. /media/product/, /images/I/, /is/image/).
- If the URL looks like a thumbnail (e.g. _SS40_, _SX38_), strip the size suffix to get the full-size version when safe.

OUTPUT (JSON only, no prose, no markdown fences):
{"imageUrl": "<absolute https URL, or empty string if no confident match>"}

If you are not confident the URL is on a preferred-host CDN and shows the actual product, return {"imageUrl": ""}. Empty is better than wrong.`;

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
            max_uses: 4,
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
  if (isBlockedHost(url)) {
    console.warn(
      `[image-lookup] dropping blocked-host result for ${identity.brand} ${identity.itemName}: ${url}`,
    );
    return null;
  }
  return url;
}

/**
 * Returns true if the URL's host is on the blocklist (aggregators, social,
 * marketplaces, search-engine wrappers). Matches the registered domain plus
 * any subdomain — so both `pinterest.com` and `i.pinimg.com` get caught.
 */
export function isBlockedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  for (const blocked of BLOCKED_IMAGE_HOSTS) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
