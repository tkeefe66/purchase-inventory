import type Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../anthropic-retry.js';
import { MODELS } from '../models.js';

/**
 * Resolves a federal-agency rec-area name to its canonical URL using Sonnet
 * 4.6 + Anthropic's web_search tool. Used to replace placeholder Google
 * site-search URLs with the actual first organic result on fs.usda.gov or
 * blm.gov.
 *
 * Same pattern as `lib/parsers/rei-product-lookup.ts` — Haiku 4.5 doesn't
 * support programmatic tool calling (which web_search requires), so Sonnet
 * is the right cost/capability tier. Anthropic's commercial search handles
 * the actual SERP scrape; we just have Sonnet pick the canonical agency
 * page from the results.
 *
 * Cost: ~$0.02-0.03 per call (Sonnet tokens + 1-2 web_search calls).
 * Roughly $15-25 to enrich the full Western-US USFS+BLM dispersed set
 * (~793 records). Results should be cached by (source, id) on disk so
 * weekly refreshes only re-resolve net-new records.
 */

const SYSTEM_PROMPT = `You resolve a federal recreation-site name to its canonical agency URL.

You will be given: a rec-area name, the managing agency (e.g. "Carson National Forest" or "BLM Tres Rios Field Office"), and an agency domain (e.g. "fs.usda.gov" or "blm.gov").

Use web_search (1-2 searches) to find the OFFICIAL agency page for this specific rec area. Prefer queries like:
  site:<domain> "<rec area name>" "<agency>"

Pick the FIRST organic (non-ad, non-sponsored) result whose URL is on the agency domain AND whose page is specifically about this rec area — NOT a generic forest/office overview, NOT a list page, NOT a campground-search results page.

Return ONLY a single URL on its own line. No prose, no markdown, no quotes.

If you cannot find a confident match on the agency domain, return the literal string:
NONE`;

export async function resolveAgencyUrl(
  anthropic: Anthropic,
  opts: { name: string; agency: string; domain: string },
): Promise<string | null> {
  const userText = `name: ${opts.name}\nagency: ${opts.agency}\ndomain: ${opts.domain}`;

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
      `[url-resolver] Sonnet call failed for ${opts.name}: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }

  // Pull the last text block — Haiku may emit interleaved tool_use blocks.
  const textBlocks = resp.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) return null;

  const candidate = lastText.text.trim();
  if (!candidate || candidate === 'NONE') return null;

  // Extract the first URL-looking token; the model occasionally adds
  // trailing punctuation despite the prompt.
  const m = candidate.match(/https?:\/\/[^\s<>"')]+/i);
  if (!m) return null;
  const url = m[0];

  // Sanity check — must be on the requested domain. Hold the line on
  // hallucinated cross-domain links.
  if (!url.toLowerCase().includes(opts.domain.toLowerCase())) return null;
  return url;
}
