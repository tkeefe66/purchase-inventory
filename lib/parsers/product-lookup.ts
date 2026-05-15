import type Anthropic from '@anthropic-ai/sdk';
import { VISION_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';

export interface ProductCandidate {
  itemName: string;
  productUrl: string;
  source: string;
}

// Curated list — Anthropic's crawler is blocked by many large-enterprise sites
// (Sony confirmed via 400 response 2026-05-14); avoid camera/electronics
// brands and stick with outdoor-focused retailers and mid-size gear brands.
// The auto-retry below will drop any domain Anthropic flags as inaccessible
// on a future request, so this list can evolve without breaking the bot.
const PRODUCT_LOOKUP_DOMAINS = [
  // Major retailers — proven working via the outdoor agent's tool list
  'rei.com', 'backcountry.com', 'evo.com', 'moosejaw.com', 'competitivecyclist.com',
  'nrs.com', 'jensonusa.com', 'amazon.com', 'llbean.com', 'cabelas.com', 'basspro.com',
  'mec.ca',
  // Outdoor brand sites (mid-size, likely accessible)
  'patagonia.com', 'arcteryx.com', 'blackdiamondequipment.com', 'osprey.com',
  'mammut.com', 'salomon.com', 'lasportiva.com', 'scarpa.com', 'merrell.com', 'altrarunning.com',
  'hokaoneone.com', 'brooksrunning.com', 'mountainhardwear.com', 'kuhl.com', 'cotopaxi.com',
  'fjallraven.com', 'outdoorresearch.com', 'darntough.com', 'smartwool.com',
  'icebreaker.com', 'feathered-friends.com', 'enlightenedequipment.com', 'zpacks.com',
  'gossamergear.com', 'jetboil.com', 'sea-to-summit.com', 'thermarest.com',
  'nemoequipment.com', 'bigagnes.com', 'kelty.com',
  // Cycling brand sites
  'specialized.com', 'trekbikes.com', 'cannondale.com', 'giant-bicycles.com',
  'santacruzbicycles.com', 'ibiscycles.com', 'rocky-mountain.com', 'kona.com',
  'salsacycles.com', 'surly.bikes',
];

const SYSTEM_PROMPT = `You help match outdoor gear photos to their canonical product pages.

The user took a photo of a piece of gear, vision extracted a brand and a possibly-imperfect product name, and now we need 1-3 candidate product pages so the user can pick the right one.

Use web_search (up to 2 searches) to find matching product pages on the brand's official site or major outdoor retailers. Prefer brand official pages first, then large retailers (REI, Backcountry).

Return JSON only with this exact shape:
{
  "candidates": [
    {
      "itemName": "<canonical product name as listed on the page, brand prefix STRIPPED>",
      "productUrl": "<full https URL to the direct product page>",
      "source": "<domain, e.g. 'patagonia.com'>"
    }
  ]
}

Rules:
- Up to 3 candidates total
- itemName must NOT include the brand (we store brand separately)
- productUrl must start with https:// and link to a direct product page (NOT search results, NOT category listings)
- If you can't find any confident match, return {"candidates": []}
- Skip stale/discontinued links if newer versions exist
- Return JSON only, no prose, no markdown fences`;

export async function lookupProduct(
  anthropic: Anthropic,
  brand: string,
  visionItemName: string,
): Promise<ProductCandidate[]> {
  const query = `${brand} ${visionItemName}`.trim();
  if (!brand.trim() || !visionItemName.trim()) return [];

  const resp = await callWebSearchWithDomainFallback(anthropic, query, PRODUCT_LOOKUP_DOMAINS);
  if (!resp) return [];

  const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) {
    console.warn(`[product-lookup] no text block in response for "${query}"`);
    return [];
  }

  // Strip common JSON wrappers Claude sometimes adds despite "no markdown fences"
  // (```json ... ``` or stray prose before/after the object).
  const cleaned = extractJsonObject(lastText.text);
  if (!cleaned) {
    console.warn(`[product-lookup] could not isolate JSON in response for "${query}": ${lastText.text.slice(0, 200)}`);
    return [];
  }

  let raw: { candidates?: unknown };
  try {
    raw = JSON.parse(cleaned) as { candidates?: unknown };
  } catch (err) {
    console.warn(`[product-lookup] JSON parse failed for "${query}": ${err instanceof Error ? err.message : err}`);
    return [];
  }

  if (!Array.isArray(raw.candidates)) {
    console.info(`[product-lookup] no candidates in response for "${query}"`);
    return [];
  }

  const out = raw.candidates
    .filter((c): c is { itemName: string; productUrl: string; source?: string } =>
      typeof c === 'object' && c !== null
      && typeof (c as Record<string, unknown>).itemName === 'string'
      && ((c as Record<string, unknown>).itemName as string).length > 0
      && typeof (c as Record<string, unknown>).productUrl === 'string'
      && ((c as Record<string, unknown>).productUrl as string).startsWith('http'),
    )
    .slice(0, 3)
    .map((c) => {
      let source = typeof c.source === 'string' ? c.source : '';
      if (!source) {
        try { source = new URL(c.productUrl).hostname.replace(/^www\./, ''); } catch { /* leave blank */ }
      }
      return { itemName: c.itemName, productUrl: c.productUrl, source };
    });
  console.info(`[product-lookup] "${query}" → ${out.length} candidate(s)`);
  return out;
}

// Retailers that aggressively serve a bot-shield / generic landing page to
// non-browser User-Agents — the title we'd extract is junk like "Amazon.com"
// or "Robot Check". Vision's itemName beats that, so we skip refinement and
// let the caller fall back to it.
const FETCH_BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  'amazon.com', 'amzn.to', 'amzn.com', 'smile.amazon.com',
]);

/**
 * Fetch a product page and extract its canonical name from <title> or og:title.
 * Strips the brand prefix and common trailing site-name patterns
 * ("... | REI Co-op", "... - L.L.Bean").
 *
 * Returns null on network error, non-2xx, parse failure, empty extraction, or
 * a junk-looking title (hostname-only, bot-shield phrases, brand-only).
 * Pure heuristic — no LLM call. Sufficient for the major outdoor retailer
 * and brand sites, which all render product name into <title>/og:title
 * server-side.
 */
export async function fetchProductName(url: string, brand: string): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return null; }
  if (FETCH_BLOCKED_HOSTS.has(host)) {
    console.info(`[product-lookup] skipping title-refine for known-blocked host ${host}`);
    return null;
  }

  let html: string;
  try {
    const resp = await fetch(url, {
      headers: {
        // Some retailer sites 403 on missing UA — present as a normal browser.
        'User-Agent': 'Mozilla/5.0 (compatible; outdoor-inventory/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      console.warn(`[product-lookup] fetchProductName HTTP ${resp.status} for ${url}`);
      return null;
    }
    html = await resp.text();
  } catch (err) {
    console.warn(`[product-lookup] fetchProductName failed for ${url}: ${err instanceof Error ? err.message : err}`);
    return null;
  }

  // Match content="..." or content='...' — DON'T use [^"'] because product
  // names frequently contain apostrophes (Men's, women's, 8" boots, etc.).
  const ogMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content="([^"]*)"/i)
    ?? html.match(/<meta[^>]+property=["']og:title["'][^>]+content='([^']*)'/i)
    ?? html.match(/<meta[^>]+content="([^"]*)"[^>]+property=["']og:title["']/i)
    ?? html.match(/<meta[^>]+content='([^']*)'[^>]+property=["']og:title["']/i);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  let name = decodeBasicEntities((ogMatch?.[1] ?? titleMatch?.[1] ?? '').trim());
  if (!name) return null;

  // Strip trailing site-name pattern: " | REI Co-op", " - L.L.Bean", " — Patagonia"
  name = name.replace(/\s*[|\-–—]\s*[A-Z][\w&.'\s-]*$/u, '').trim();

  // Strip the brand prefix if present (case-insensitive, allowing punctuation drift).
  const brandTokens = brand.replace(/[.,]/g, '').toLowerCase().split(/\s+/).filter(Boolean);
  if (brandTokens.length > 0) {
    const nameTokens = name.split(/\s+/);
    let prefixLen = 0;
    while (prefixLen < brandTokens.length && prefixLen < nameTokens.length) {
      const candidate = nameTokens[prefixLen]!.replace(/[.,]/g, '').toLowerCase();
      if (candidate !== brandTokens[prefixLen]) break;
      prefixLen++;
    }
    if (prefixLen > 0 && prefixLen <= brandTokens.length) {
      name = nameTokens.slice(prefixLen).join(' ').trim();
    }
  }

  if (name.length === 0) return null;
  if (isJunkTitle(name, host, brand)) {
    console.warn(`[product-lookup] rejecting junk title "${name}" from ${url}`);
    return null;
  }
  return name;
}

/**
 * Reject titles that clearly aren't a product name — they tend to come from
 * bot-shield landing pages or error pages. Caller falls back to vision's
 * itemName when this fires.
 */
function isJunkTitle(name: string, host: string, brand: string): boolean {
  const lower = name.toLowerCase().trim();
  if (lower.length < 3) return true;

  // Title equals the source hostname or its bare domain — common bot-shield
  // signature ("Amazon.com", "ebay"). The strict equality is intentional;
  // a real product title like "Bean Boots — L.L.Bean" has already been
  // trimmed of the site suffix by this point.
  if (host) {
    if (lower === host) return true;
    const bareDomain = host.split('.')[0];
    if (bareDomain && lower === bareDomain) return true;
  }

  // Title is just the brand — nothing identifying about it.
  if (brand && lower === brand.toLowerCase().trim()) return true;

  // Common error / captcha / sign-in / not-found markers.
  const junkPatterns: readonly RegExp[] = [
    /^robot check\b/i,
    /^sorry\b/i,
    /^sign[- ]?in\b/i,
    /^login\b/i,
    /^page not found\b/i,
    /^not found\b/i,
    /^access denied\b/i,
    /^are you a robot\b/i,
    /\bcaptcha\b/i,
    /^just a moment\b/i,
    /^attention required\b/i,
    /^404\b/,
    /^error\b/i,
  ];
  return junkPatterns.some((p) => p.test(name));
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Calls the web_search tool, transparently retrying without any domains
 * Anthropic flags as inaccessible (per the support page link in the 400
 * error). Returns null on a non-recoverable error.
 */
async function callWebSearchWithDomainFallback(
  anthropic: Anthropic,
  query: string,
  initialDomains: readonly string[],
): Promise<Anthropic.Messages.Message | null> {
  let domains = [...initialDomains];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callWithRetry(() =>
        anthropic.messages.create({
          model: VISION_MODEL,
          max_tokens: 1024,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: `Find product page candidates for: ${query}` }],
          tools: [{
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 2,
            allowed_domains: domains,
          }] as unknown as Anthropic.Messages.Tool[],
        }),
      );
    } catch (err) {
      const blocked = extractBlockedDomains(err);
      if (blocked.length === 0) {
        console.warn(`[product-lookup] non-recoverable error for "${query}": ${err instanceof Error ? err.message : err}`);
        return null;
      }
      const filtered = domains.filter((d) => !blocked.includes(d));
      if (filtered.length === domains.length) {
        // Anthropic reported blocked domains we don't actually have — bail.
        console.warn(`[product-lookup] blocked-domain list ${blocked.join(', ')} didn't intersect ours, giving up`);
        return null;
      }
      console.warn(`[product-lookup] dropping blocked domains and retrying: ${blocked.join(', ')}`);
      domains = filtered;
    }
  }
  console.warn(`[product-lookup] gave up after 3 fallback attempts for "${query}"`);
  return null;
}

/** Parses Anthropic's "The following domains are not accessible" 400-message. */
function extractBlockedDomains(err: unknown): string[] {
  const msg = err instanceof Error ? err.message : String(err);
  const m = /domains are not accessible[^\[]*\[([^\]]+)\]/i.exec(msg);
  if (!m) return [];
  return m[1]!
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter((s) => s.length > 0);
}

/**
 * Find the first balanced JSON object in a string, tolerating wrapping markdown
 * fences and any leading/trailing prose. Returns null if no object is found.
 */
function extractJsonObject(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  if (fence) return fence[1] ?? null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
