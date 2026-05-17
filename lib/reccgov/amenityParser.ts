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
  /**
   * Short-form rules / restrictions extracted from the description.
   * Examples: "Pets must be leashed", "Max stay 14 days", "No campfires
   * above 9000 ft". Empty array if the description doesn't mention any.
   * Each entry should be one phrase, not a paragraph.
   */
  restrictions: string[];
}

const SYSTEM_PROMPT = `You extract structured camping facts from Rec.gov campground descriptions.

Be conservative: if the description doesn't explicitly state or strongly imply something, return null (or [] for restrictions). Don't guess.

Restrooms:
- "vault toilet" / "pit toilet" / "outhouse" → restroomType: "vault", hasRestrooms: true
- "flush toilet" / "modern restroom" / "comfort station" → restroomType: "flush", hasRestrooms: true
- both mentioned → restroomType: "both", hasRestrooms: true
- "no toilets" / "no restrooms" → restroomType: "none", hasRestrooms: false
- not mentioned → both null

Drinking water:
- "drinking water" / "potable water" / "water spigot" → hasDrinkingWater: true
- "no water" / "bring your own water" → hasDrinkingWater: false
- not mentioned → null

Restrictions (return short phrases, not full sentences):
- Pet rules: "Pets on leash" / "No pets" / "Service animals only"
- Stay limits: "Max stay 14 days" / "Max stay 7 days"
- Fire rules: "No campfires" / "Fire ban above 9000 ft" / "Fire ring required"
- Vehicle/RV limits: "No RVs over 30 ft" (only if it's a HARD rule, not a max-length field)
- Other rules: "No generators after 10pm", "Bear box required", "Reservations only — no walk-ups"

Return at most 6 of the most important restrictions. Skip generic advice ("be bear aware", "leave no trace") — those are warnings, not restrictions. Empty array if no specific restrictions stated.

Return ONLY a JSON object matching the schema. No explanation.`;

// Anthropic structured outputs require anyOf for nullable; the array-type
// shorthand `type: [X, "null"]` errors when combined with enum.
const SCHEMA = {
  type: 'object' as const,
  properties: {
    hasRestrooms: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    restroomType: {
      anyOf: [
        { type: 'string', enum: ['vault', 'flush', 'both', 'none'] },
        { type: 'null' },
      ],
    },
    hasDrinkingWater: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
    restrictions: { type: 'array', items: { type: 'string' } },
  },
  required: ['hasRestrooms', 'restroomType', 'hasDrinkingWater', 'restrictions'] as const,
  additionalProperties: false as const,
};

const EMPTY: AmenityFacts = {
  hasRestrooms: null, restroomType: null, hasDrinkingWater: null, restrictions: [],
};

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
      restrictions: Array.isArray(parsed.restrictions) ? parsed.restrictions.slice(0, 6) : [],
    };
  } catch {
    return EMPTY;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}
