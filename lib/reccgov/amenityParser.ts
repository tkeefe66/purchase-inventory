import Anthropic from '@anthropic-ai/sdk';
import { callWithRetry } from '../anthropic-retry.js';
import { PARSER_MODEL } from '../models.js';

/**
 * Structured amenities extracted from Rec.gov's free-text FacilityDescription.
 *
 * RIDB doesn't expose these as structured fields — the only source is prose
 * like "Vault toilets, drinking water, and fire rings are provided." Haiku
 * 4.5 with structured outputs reliably extracts this in 1 short call per
 * facility (~500 input tokens, ~50 output tokens).
 *
 * All fields are `boolean | null` — null means "couldn't determine from
 * description" (e.g., description is empty or doesn't mention restrooms).
 */
export interface AmenityFacts {
  hasRestrooms: boolean | null;
  restroomType: 'vault' | 'flush' | 'both' | 'none' | null;
  hasDrinkingWater: boolean | null;
}

const SYSTEM_PROMPT = `You extract structured camping amenities from Rec.gov campground descriptions.

Read the description and return what it explicitly states or strongly implies about restrooms and drinking water. Be conservative — if the description doesn't mention an amenity, return null for that field (don't guess).

Rules:
- "vault toilet" / "pit toilet" / "outhouse" → restroomType: "vault", hasRestrooms: true
- "flush toilet" / "modern restroom" / "comfort station" → restroomType: "flush", hasRestrooms: true
- both mentioned → restroomType: "both", hasRestrooms: true
- "no toilets" / "no restrooms" → restroomType: "none", hasRestrooms: false
- not mentioned → both null
- "drinking water" / "potable water" / "water spigot" → hasDrinkingWater: true
- "no water" / "bring your own water" → hasDrinkingWater: false
- not mentioned → null

Return ONLY a JSON object matching the schema. No explanation.`;

const SCHEMA = {
  type: 'object' as const,
  properties: {
    hasRestrooms: { type: ['boolean', 'null'] as const },
    restroomType: { type: ['string', 'null'] as const, enum: ['vault', 'flush', 'both', 'none', null] },
    hasDrinkingWater: { type: ['boolean', 'null'] as const },
  },
  required: ['hasRestrooms', 'restroomType', 'hasDrinkingWater'] as const,
  additionalProperties: false as const,
};

const EMPTY: AmenityFacts = { hasRestrooms: null, restroomType: null, hasDrinkingWater: null };

export async function parseAmenities(
  description: string,
  client: Anthropic,
): Promise<AmenityFacts> {
  const text = stripHtml(description).trim();
  if (text.length < 30) return EMPTY;

  try {
    const response = await callWithRetry(() =>
      client.messages.create({
        model: PARSER_MODEL,
        max_tokens: 200,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            // Prompt-cache the system prompt — it's identical across all
            // ~278 facilities in a metadata-refresh run, so the cache hit
            // rate is ~99% after the first call.
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: {
          format: { type: 'json_schema', schema: SCHEMA },
        },
        messages: [
          { role: 'user', content: `Description:\n${text.slice(0, 2000)}` },
        ],
      }),
    );

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return EMPTY;
    const parsed = JSON.parse(block.text) as Partial<AmenityFacts>;
    return {
      hasRestrooms: parsed.hasRestrooms ?? null,
      restroomType: parsed.restroomType ?? null,
      hasDrinkingWater: parsed.hasDrinkingWater ?? null,
    };
  } catch {
    return EMPTY;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}
