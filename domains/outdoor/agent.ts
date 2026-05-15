import Anthropic from '@anthropic-ai/sdk';
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import type { SheetsClient } from '../../lib/sheets.js';
import type { Status } from '../../lib/types.js';
import { ConversationStore } from '../../lib/conversations.js';
import { Stats } from '../../apps/bot/stats.js';
import { createTools, TOOL_SCHEMAS, type ToolHandlers } from './tools.js';

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

Be concise. Ask clarifying questions before recommending — don't assume. When you don't know something specific (current prices, recent product releases, current trail or surf conditions), say so. Never invent facts.`;

const REI_PREFERENCE = `When recommending purchases, prefer REI when both retailers carry an item — Tom is a co-op member and that's his default store. Mention the dividend or return-policy advantage in close calls.`;

const TOOL_GUIDANCE = `You have two tools available:

- get_product_url(item_id) — when the user asks for a link to a specific item, or when you want to point them at a product page. The item_id is the 6-character id shown in brackets at the start of each inventory row.

- update_status(item_id, new_status) — when the user tells you they lost, sold, donated, retired, returned, or broke an item, or wants to mark it excluded. Possible new_status values: active, retired, returned, lost, broken, sold, donated, excluded. After calling this tool, confirm to the user what changed.

Use tools sparingly: only call when needed. Do not call get_product_url unprompted.`;

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

const SONNET_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_TOOL_LOOPS = 8;

export interface OutdoorAgentOptions {
  cache: InventoryCache;
  conversations: ConversationStore;
  stats: Stats;
  anthropic: Anthropic;
  sheets: SheetsClient;
  spreadsheetId: string;
  updateRowStatus: (
    sheets: SheetsClient,
    spreadsheetId: string,
    input: { rowIndex: number; newStatus: Status },
  ) => Promise<void>;
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

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
      const callStart = Date.now();
      const resp = await this.opts.anthropic.messages.create({
        model: SONNET_MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: messages as Anthropic.Messages.MessageParam[],
        tools: TOOL_SCHEMAS as unknown as Anthropic.Messages.Tool[],
      });
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

  private async dispatchTool(name: string, input: unknown): Promise<unknown> {
    if (name === 'get_product_url') {
      return this.tools.get_product_url(input as { item_id: string });
    }
    if (name === 'update_status') {
      return this.tools.update_status(input as { item_id: string; new_status: Status });
    }
    return { ok: false, message: `Unknown tool: ${name}` };
  }
}
