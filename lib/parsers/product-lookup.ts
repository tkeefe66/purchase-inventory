import type Anthropic from '@anthropic-ai/sdk';
import { VISION_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';

export interface ProductCandidate {
  itemName: string;
  productUrl: string;
  source: string;
}

const PRODUCT_LOOKUP_DOMAINS = [
  // Retailers
  'rei.com', 'backcountry.com', 'evo.com', 'moosejaw.com', 'competitivecyclist.com',
  'nrs.com', 'jensonusa.com', 'amazon.com', 'llbean.com', 'cabelas.com', 'basspro.com',
  // Brand official sites
  'patagonia.com', 'arcteryx.com', 'blackdiamondequipment.com', 'osprey.com', 'rab.equipment',
  'mammut.com', 'salomon.com', 'lasportiva.com', 'scarpa.com', 'merrell.com', 'altrarunning.com',
  'hokaoneone.com', 'brooksrunning.com', 'nikon.com', 'canon.com', 'sony.com', 'gopro.com',
  'mountainhardwear.com', 'kuhl.com', 'cotopaxi.com', 'fjallraven.com', 'thenorthface.com',
  'columbia.com', 'marmot.com', 'outdoorresearch.com', 'darntough.com', 'smartwool.com',
  'icebreaker.com', 'patagoniaprovisions.com', 'mec.ca', 'feathered-friends.com', 'rabusa.com',
  'enlightenedequipment.com', 'zpacks.com', 'gossamergear.com', 'msrgear.com', 'msr.com',
  'jetboil.com', 'biolitestove.com', 'snowpeak-usa.com', 'sea-to-summit.com', 'thermarest.com',
  'nemoequipment.com', 'bigagnes.com', 'eddiebauer.com', 'kelty.com', 'sierra.com',
  'shimano-cycling.com', 'sram.com', 'specialized.com', 'trekbikes.com', 'cannondale.com',
  'giant-bicycles.com', 'santacruzbicycles.com', 'yetiCycles.com', 'ibiscycles.com',
  'rocky-mountain.com', 'kona.com', 'salsacycles.com', 'surly.bikes',
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

  const resp = await callWithRetry(() =>
    anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `Find product page candidates for: ${query}`,
      }],
      tools: [{
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 2,
        allowed_domains: PRODUCT_LOOKUP_DOMAINS,
      }] as unknown as Anthropic.Messages.Tool[],
    }),
  );

  const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
  const lastText = textBlocks[textBlocks.length - 1];
  if (!lastText) return [];

  let raw: { candidates?: unknown };
  try {
    raw = JSON.parse(lastText.text) as { candidates?: unknown };
  } catch {
    return [];
  }

  if (!Array.isArray(raw.candidates)) return [];

  return raw.candidates
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
}
