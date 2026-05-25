/**
 * Photography expander — turns a Topic\'s tight `theorySeed` / `assignmentSeed`
 * into either:
 *   - a polished lesson (markdown prose) for `/learn`
 *   - a concrete assignment + rubric (JSON) for `/start`
 *
 * Uses Sonnet 4.6 with cached system prompt. Has access to OSM trail tools
 * for location suggestions but NOT to weather / sun-times — assignments must
 * stay reusable, so we embed CONDITIONS ("at golden hour") not DATES
 * ("Saturday May 23 at 8:11pm"). The agent\'s conversational interface
 * handles current-conditions queries separately.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { callWithRetry } from '../../lib/anthropic-retry.js';
import {
  searchTrailsNearby,
  lookupTrail,
  type TrailActivity,
} from '../../lib/integrations/trails.js';
import { geocode } from '../../lib/integrations/weather.js';
import type { Topic } from './skillTree.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface RubricCriterion {
  criterion: string;
  description: string;
  is_core: boolean;
}

export interface ExpandedAssignment {
  assignmentText: string;
  rubric: RubricCriterion[];
}

export interface ExpanderDeps {
  anthropic: Anthropic;
  /** Compact text of Tom\'s active photography inventory; embedded as cached
   *  system context for grounding. */
  inventoryText: string;
  /** Tom\'s home base for trail suggestions; default "Boulder, CO". */
  homeLocation?: string;
  /** Optional override of the model — useful for tests + cost-tuning. */
  model?: string;
}

const DEFAULT_HOME = 'Boulder, CO';
const DEFAULT_MODEL = MODELS.sonnet;
const MAX_TOOL_LOOPS = 4;
const MAX_TOKENS = 1500;

// ─── Tool schemas (trails only — no weather/sun-times) ───────────────────

const TRAIL_TOOL_SCHEMAS = [
  {
    name: 'lookup_trail',
    description:
      "Look up a specific named trail. Returns OSM-tagged trail data: length, surface, difficulty (SAC scale for hiking, mtb:scale for MTB), suitable activities, and a map link. Useful when the assignment mentions or could mention a specific Boulder-area trail or hike. Use sparingly — only when a named trail genuinely fits the assignment.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Trail name to look up.' },
        near_location: { type: 'string', description: 'Optional bias location, default "Boulder, CO".' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_trails_nearby',
    description:
      "Find trails within a radius of a place, optionally filtered by activity. Use to discover Boulder-area trails / overlooks / parks that fit a landscape, wildlife, or travel assignment. Sorted by distance. Use sparingly — at most one call per expansion.",
    input_schema: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Place name to center search; default "Boulder, CO".' },
        radius_km: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
        activity: { type: 'string', enum: ['hiking', 'mtb', 'trail-running'], description: 'Optional activity filter.' },
      },
      required: ['location'],
    },
  },
] as const;

// ─── Prompts ──────────────────────────────────────────────────────────────

const TOM_GEAR = `Tom's photography kit:
- Sony a6700 (APS-C mirrorless, 26MP, IBIS ~3 stops, AI subject recognition AF for Human / Animal / Bird / Insect / Car / Train / Airplane)
- Sigma 18-50 f/2.8 DC DN Contemporary (his main lens; 27-75mm full-frame equivalent on APS-C)
- Sony E 70-350mm f/4.5-6.3 G OSS (his telephoto; 105-525mm full-frame equivalent)
- Epson EcoTank ET-8550 (wide-format 13x19 printer with dedicated Gray ink for B&W)
- Capture Clip, Think Tank lens pouches, USA Gear sleeve, 128GB SD card
- Tom's location: Boulder, CO (Front Range, mix of plains + foothills + mountains)`;

const PERSONA = `You are Tom's personal photography tutor — patient, opinionated, gear-aware. Tom is a total beginner who recently bought a serious mirrorless setup specifically to learn photography. Your job is to translate compact topic seeds into either polished lessons or concrete assignments.

Tone: direct, specific, occasionally dry. NO motivational filler. NO "remember to have fun!" NO bullet-point listicles unless the structure genuinely helps. Write like a knowledgeable friend, not a marketing brochure.`;

const ASSIGNMENT_RULES = `You are generating ONE photography assignment from a topic seed.

CRITICAL RULES — read these carefully:
1. The assignment must specify CONDITIONS Tom can wait for (e.g., "at golden hour", "in low light", "on a windy day"). Conditions are timeless requirements.
2. NEVER bake in specific dates, current weather, or forecasts. Tom may not start this assignment for two weeks — anything time-bound goes stale.
3. If location is genuinely relevant (landscape, wildlife, street, etc.), you MAY call \`search_trails_nearby\` or \`lookup_trail\` ONCE to suggest 1-3 Boulder-area trails / parks / overlooks. Trail names + features are timeless; current trail conditions / closures are not — don't speculate about those.
4. Reference Tom's actual gear by name when relevant (Sigma 18-50, Sony 70-350, a6700, ET-8550). Don't recommend gear he doesn't have.
5. Rubric: 2-4 criteria. AT LEAST ONE must be \`is_core: true\` (failing a core criterion fails the assignment; failing a non-core is recoverable). Each criterion is a single sentence.
6. Assignment text: 80-200 words for Tier 3-4 topics; up to 300 words for Tier 1-2 topics to accommodate step-by-step detail. Specific and actionable. Skip generic advice ("be creative!"); give concrete operating instructions.
7. TIER-AWARE DETAIL LEVEL — this is critical for Tom's learning:
   - **Tier 1-2:** Tom is a complete beginner. For every camera setting change, tell him WHICH PHYSICAL CONTROL to use: "rotate the front command dial" not just "set aperture to f/8". Give concrete starting values: "set f/4, 1/125, ISO 100" not "adjust to taste". After each shot, tell him WHAT TO CHECK on the LCD: "zoom in — is the background blurry? That's shallow depth of field" or "look at the meter bar at the bottom of the viewfinder — is it centred on 0?" Include ONE common beginner mistake to avoid per shot when relevant.
   - **Tier 3-4:** Tom knows his way around the camera by now. Focus on creative intent and technique. Physical button instructions are unnecessary.

OUTPUT FORMAT — output a SINGLE JSON object inside a \`\`\`json fenced code block, nothing else outside the fence:

\`\`\`json
{
  "assignment_text": "...",
  "rubric": [
    {"criterion": "...", "description": "(optional, 1 short sentence elaboration)", "is_core": true},
    {"criterion": "...", "description": "...", "is_core": false}
  ]
}
\`\`\``;

const LESSON_RULES = `You are generating ONE photography lesson from a topic seed.

CRITICAL RULES:
1. Reference Tom's actual gear by name when relevant. Don't talk about full-frame Sony bodies or Canon RFs — he has an a6700 + Sigma 18-50 + Sony 70-350 + ET-8550.
2. If a location example would help, you MAY call \`lookup_trail\` or \`search_trails_nearby\` once for a Boulder-area reference. Skip if not relevant.
3. NEVER include weather forecasts, current trail conditions, or specific dates. The lesson must read the same way in 6 months.
4. Length: ~250-400 words. Structure however the topic best supports — paragraphs, occasional bullets, but no formal sections.
5. Direct, specific tone. NO motivational filler. NO "remember photography is about having fun." Treat Tom like a smart adult learning a craft.

OUTPUT FORMAT — markdown prose ONLY. No JSON, no preamble, no "Here is your lesson:". Just the lesson text itself. End with one sentence about what to do next (e.g., "When you\'re ready, run \`/start <topic-id>\` to put this into practice.")`;

// ─── Public API ───────────────────────────────────────────────────────────

export async function expandAssignment(
  deps: ExpanderDeps,
  topic: Topic,
): Promise<ExpandedAssignment> {
  const text = await runExpander(deps, topic, 'assignment');
  return parseExpandedAssignment(text);
}

export async function expandLesson(
  deps: ExpanderDeps,
  topic: Topic,
): Promise<string> {
  return runExpander(deps, topic, 'lesson');
}

// ─── Core loop ────────────────────────────────────────────────────────────

async function runExpander(
  deps: ExpanderDeps,
  topic: Topic,
  kind: 'assignment' | 'lesson',
): Promise<string> {
  const system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    { type: 'text', text: PERSONA },
    { type: 'text', text: TOM_GEAR },
    {
      type: 'text',
      text: `Tom's current photography inventory:\n${deps.inventoryText}`,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: kind === 'assignment' ? ASSIGNMENT_RULES : LESSON_RULES },
  ];

  const userText = buildUserPrompt(topic, kind);
  type Msg = { role: 'user' | 'assistant'; content: unknown };
  const messages: Msg[] = [{ role: 'user', content: userText }];

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
    const resp = await callWithRetry(() =>
      deps.anthropic.messages.create({
        model: deps.model ?? DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: TRAIL_TOOL_SCHEMAS as unknown as Anthropic.Messages.Tool[],
        messages: messages as unknown as Anthropic.Messages.MessageParam[],
      }),
    );

    if (resp.stop_reason === 'tool_use') {
      const toolUses = resp.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );
      messages.push({ role: 'assistant', content: resp.content });
      const results: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const block of toolUses) {
        const result = await dispatchTrailTool(block.name, block.input, deps.homeLocation ?? DEFAULT_HOME);
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    const textBlocks = resp.content.filter(
      (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
    );
    const out = textBlocks.map((b) => b.text).join('\n').trim();
    if (!out) {
      throw new Error(`Expander returned empty text (stop_reason=${resp.stop_reason})`);
    }
    return out;
  }

  throw new Error(`Expander exceeded ${MAX_TOOL_LOOPS} tool-loop iterations without producing text.`);
}

function buildUserPrompt(topic: Topic, kind: 'assignment' | 'lesson'): string {
  if (kind === 'assignment') {
    return `Generate the assignment for this topic:

Topic id: \`${topic.id}\`
Branch: ${topic.branch}, Tier ${topic.tier}
Name: ${topic.name}
Description: ${topic.description}

Seed (your scaffold — expand, refine, make concrete):
${topic.assignmentSeed}

Output the JSON object as instructed.`;
  }
  return `Generate the lesson for this topic:

Topic id: \`${topic.id}\`
Branch: ${topic.branch}, Tier ${topic.tier}
Name: ${topic.name}
Description: ${topic.description}

Seed (your scaffold — expand, refine, make concrete):
${topic.theorySeed}

Output the lesson as markdown prose only.`;
}

// ─── Trail tool dispatch ──────────────────────────────────────────────────

async function dispatchTrailTool(
  name: string,
  input: unknown,
  defaultLocation: string,
): Promise<unknown> {
  if (name === 'lookup_trail') {
    const i = input as { name: string; near_location?: string };
    if (!i.name?.trim()) return { ok: false, error: 'name is required' };
    const opts: Parameters<typeof lookupTrail>[1] = {};
    const place = i.near_location ?? defaultLocation;
    try {
      const coords = await geocode(place);
      opts.lat = coords.lat;
      opts.lng = coords.lon;
    } catch {
      // Continue unbiased — better than failing the whole call.
    }
    try {
      const trails = await lookupTrail(i.name, opts);
      return { ok: true, trails };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'lookup_failed' };
    }
  }
  if (name === 'search_trails_nearby') {
    const i = input as { location?: string; radius_km?: number; activity?: TrailActivity };
    const place = i.location?.trim() || defaultLocation;
    let coords: { lat: number; lon: number };
    try {
      coords = await geocode(place);
    } catch {
      return { ok: false, error: 'could_not_geocode' };
    }
    try {
      const trails = await searchTrailsNearby({
        lat: coords.lat,
        lng: coords.lon,
        radiusKm: i.radius_km ?? 25,
        ...(i.activity ? { activity: i.activity } : {}),
      });
      return { ok: true, location: place, trails };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'search_failed' };
    }
  }
  return { error: `Unknown tool: ${name}` };
}

// ─── Pure parsing (testable without Claude) ──────────────────────────────

const JSON_FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n?```/i;

/**
 * Parse an expanded-assignment response into a typed ExpandedAssignment.
 * Tolerates the JSON being inside a fenced code block (preferred) or bare.
 * Throws with a useful message if the shape is wrong.
 */
export function parseExpandedAssignment(text: string): ExpandedAssignment {
  const fenceMatch = text.match(JSON_FENCE_RE);
  const jsonText = (fenceMatch ? fenceMatch[1]! : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Expander returned non-JSON output: ${(err as Error).message}. First 200 chars: ${jsonText.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Expander JSON is not an object.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.assignment_text !== 'string' || !obj.assignment_text.trim()) {
    throw new Error('Expander JSON is missing a non-empty assignment_text.');
  }
  if (!Array.isArray(obj.rubric) || obj.rubric.length === 0) {
    throw new Error('Expander JSON is missing a non-empty rubric array.');
  }
  const rubric: RubricCriterion[] = [];
  for (const raw of obj.rubric) {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Each rubric entry must be an object.');
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.criterion !== 'string' || !r.criterion.trim()) {
      throw new Error('Each rubric entry needs a non-empty criterion string.');
    }
    rubric.push({
      criterion: r.criterion,
      description: typeof r.description === 'string' ? r.description : '',
      is_core: r.is_core === true,
    });
  }
  if (!rubric.some((r) => r.is_core)) {
    throw new Error('At least one rubric criterion must have is_core: true.');
  }
  return {
    assignmentText: obj.assignment_text,
    rubric,
  };
}
