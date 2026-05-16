import Anthropic from '@anthropic-ai/sdk';
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import type { SheetsClient } from '../../lib/sheets.js';
import type { Status } from '../../lib/types.js';
import { ConversationStore } from '../../lib/conversations.js';
import { Stats } from '../../apps/bot/stats.js';
import { callWithRetry } from '../../lib/anthropic-retry.js';
import { AGENT_PRIMARY_MODEL, AGENT_FALLBACK_MODELS } from '../../lib/models.js';
import { createTools, TOOL_SCHEMAS, SERVER_TOOLS, type ToolHandlers, type FindFreeCampsitesInput } from './tools.js';
import type { WeatherClient } from './integrations/weather.js';
import { geocode } from './integrations/weather.js';

export interface SystemPromptInput {
  compactViewText: string;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const PERSONA = `You are Tom's personal outdoor companion — a knowledgeable guru across hiking, backpacking, mountain biking, climbing, skiing/snowboarding, paddling, surfing, trail running, and other outdoor activities. Tom's complete active outdoor inventory is included below in compact form — read it directly to answer questions about what he owns. Items he has retired, returned, lost, sold, donated, broken, or excluded are not shown; if asked about those, say you don't have that view in this conversation.

Help him with: gear questions, trip planning, picking up new activities, training advice, where-to-go suggestions, technique pointers, and buying decisions. When he's considering a purchase, scan the inventory first to avoid recommending duplicates and to understand his existing setup.

Be concise. Ask clarifying questions before recommending — don't assume. When you don't know something specific (current prices, recent product releases, current trail or surf conditions), say so. Never invent facts.

**Stay scoped to outdoor topics.** You help with outdoor activities, gear, trips, conditions, products, and the history/culture of outdoor sports and outdoor companies. If a question is clearly outside that scope — history of indoor sports (ice hockey rules, basketball), math/coding help, work stuff, general current events unrelated to outdoor — politely redirect in one sentence ("That's outside what I help with — try a general-purpose Claude. What outdoor stuff are you working on?") and stop. Borderline-fine: pond-hockey culture, snowshoeing history, the geology of a climbing destination. Borderline-out: how a hockey arena freezes its ice. When in doubt, lean toward redirecting — you're a specialist, not a generalist.

Telegram renders Markdown. When you reference a specific item from Tom's inventory by name, format it as a clickable link using the URL at the end of that item's row: \`[Brand Item Name](url)\`. If the URL is empty, just use the plain name. Do NOT force links into counts or summaries (e.g., "you own 12 tents") — only when naming a specific item Tom would want to click through to see. Use **bold** sparingly for emphasis.`;

const REI_PREFERENCE = `When recommending purchases, prefer REI when both retailers carry an item — Tom is a co-op member and that's his default store. Mention the dividend or return-policy advantage in close calls.`;

const TOOL_GUIDANCE = `You have four tools available:

- web_search — use for anything time-sensitive: current prices, current trail/snow/surf/weather conditions in prose form, recent product releases, reviews from the past year, current park/trail status. Do NOT search for things in Tom's inventory (already in context) or for general outdoor knowledge (you already know). Capped at 3 searches per turn. When you do search, cite the source domain in your reply so Tom can verify (e.g., "per outdoorgearlab.com").

- get_forecast(location, days) — call this when the user asks about weather or packing for a real upcoming trip. Pair it with the inventory you already have in context to give specific gear recommendations ("you have the Patagonia Houdini for the wind, but the forecast shows 0.6in of rain Thursday — bring the shell instead"). Don't call it for climatology questions or vague "what's it like there in spring" — only for specific forecasts in the next 7 days. Always include the destination + dates in your reply so Tom can verify. Prefer this over web_search for any weather question, since it returns structured numeric data.

- update_status(item_id, new_status) — when the user tells you they lost, sold, donated, retired, returned, or broke an item, or wants to mark it excluded. Possible new_status values: active, retired, returned, lost, broken, sold, donated, excluded. After calling this tool, confirm to the user what changed.

- get_product_url(item_id) — usually NOT needed since each inventory row already includes its product URL. Use only as a fallback if a URL is missing from the row.

Use tools sparingly: only call when needed.`;

export function buildSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  return [
    { type: 'text', text: PERSONA },
    {
      type: 'text',
      text: input.compactViewText,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: REI_PREFERENCE },
    { type: 'text', text: TOOL_GUIDANCE },
  ];
}

const MAX_TOKENS = 1024;
const MAX_TOOL_LOOPS = 8;

export interface OutdoorAgentOptions {
  cache: InventoryCache;
  conversations: ConversationStore;
  stats: Stats;
  anthropic: Anthropic;
  sheets: SheetsClient;
  spreadsheetId: string;
  weather: WeatherClient;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: Status },
  ) => Promise<void>;
  campingIndexPath?: string;
  iOverlanderCachePath?: string;
}

type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown };

export class OutdoorAgent {
  private readonly tools: ToolHandlers;

  constructor(private readonly opts: OutdoorAgentOptions) {
    this.tools = createTools({
      cache: opts.cache,
      sheets: opts.sheets,
      spreadsheetId: opts.spreadsheetId,
      updateRowStatus: opts.updateRowStatus,
      weather: opts.weather,
      geocode,
      campingIndexPath: opts.campingIndexPath ?? process.env.CAMPING_INDEX_PATH ?? '/data/camping-index.json',
      iOverlanderCachePath: opts.iOverlanderCachePath ?? process.env.IOVERLANDER_CACHE_PATH ?? '/data/iOverlander.json',
    });
  }

  async handleMessage(chatId: string, userText: string): Promise<string> {
    const system = buildSystemPrompt({ compactViewText: this.opts.cache.getCompactView().text });
    const history = this.opts.conversations.get(chatId);
    const messages: AnthropicMessage[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];

    let assistantText = '';
    let firstTokenMs = 0;
    const t0 = Date.now();
    let wasCacheHit = false;
    let totalSystemTokens = 0;
    let usedFallbackModel: string | null = null;

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
      const callStart = Date.now();
      const { resp, modelUsed } = await this.callWithModelFallback(system, messages);
      if (modelUsed !== AGENT_PRIMARY_MODEL) usedFallbackModel = modelUsed;
      if (loop === 0) {
        firstTokenMs = Date.now() - callStart;
        wasCacheHit = (resp.usage.cache_read_input_tokens ?? 0) > 0;
        totalSystemTokens = (resp.usage.cache_creation_input_tokens ?? 0) + (resp.usage.cache_read_input_tokens ?? 0);
      }

      if (resp.stop_reason === 'tool_use') {
        const toolUseBlocks = resp.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
        messages.push({ role: 'assistant', content: resp.content });
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
        for (const block of toolUseBlocks) {
          const result = await this.dispatchTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      assistantText = resp.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      break;
    }

    if (!assistantText) {
      throw new Error('Agent tool-call loop exceeded max iterations without producing a text response');
    }

    if (usedFallbackModel) {
      console.warn(`[outdoorAgent] primary model ${AGENT_PRIMARY_MODEL} returned 529; fell back to ${usedFallbackModel}`);
    }

    const totalResponseMs = Date.now() - t0;
    this.opts.stats.recordQuery({
      systemPromptTokens: totalSystemTokens,
      cacheHit: wasCacheHit,
      firstTokenMs,
      totalResponseMs,
    });

    this.opts.conversations.append(chatId, { role: 'user', content: userText });
    this.opts.conversations.append(chatId, { role: 'assistant', content: assistantText });

    return assistantText;
  }

  private async callWithModelFallback(
    system: SystemBlock[],
    messages: AnthropicMessage[],
  ): Promise<{ resp: Anthropic.Messages.Message; modelUsed: string }> {
    const baseArgs = {
      max_tokens: MAX_TOKENS,
      system,
      messages: messages as Anthropic.Messages.MessageParam[],
      tools: [...TOOL_SCHEMAS, ...SERVER_TOOLS] as unknown as Anthropic.Messages.Tool[],
    };
    const chain = [AGENT_PRIMARY_MODEL, ...AGENT_FALLBACK_MODELS];
    let lastErr: unknown;
    for (const model of chain) {
      try {
        const resp = await callWithRetry(
          () => this.opts.anthropic.messages.create({ ...baseArgs, model }),
          { maxRetries: model === AGENT_PRIMARY_MODEL ? 5 : 2 },
        );
        return { resp, modelUsed: model };
      } catch (err) {
        lastErr = err;
        if (err instanceof Anthropic.APIError && err.status === 529) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  private async dispatchTool(name: string, input: unknown): Promise<unknown> {
    if (name === 'get_product_url') {
      return this.tools.get_product_url(input as { item_id: string });
    }
    if (name === 'update_status') {
      return this.tools.update_status(input as { item_id: string; new_status: Status });
    }
    if (name === 'get_forecast') {
      return this.tools.get_forecast(input as { location: string; days: number });
    }
    if (name === 'find_free_campsites') {
      return this.tools.find_free_campsites(input as FindFreeCampsitesInput);
    }
    return { ok: false, message: `Unknown tool: ${name}` };
  }
}
