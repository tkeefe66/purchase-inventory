import { describe, test, expect, vi } from 'vitest';
import { buildSystemPrompt } from '../../../domains/outdoor/agent.js';
import { OutdoorAgent } from '../../../domains/outdoor/agent.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { ConversationStore } from '../../../lib/conversations.js';
import { Stats } from '../../../apps/bot/stats.js';
import { itemId } from '../../../domains/outdoor/types.js';
import type { MasterRow } from '../../../lib/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
} from '../../fixtures/outdoor-items.js';

const SAMPLE_COMPACT_VIEW = `=== ACTIVE OUTDOOR INVENTORY ===
Format: ...
Total rows: 2

[a1b2c3] | 2026 | Therm-a-Rest Z Lite Sol Sleeping Pad | $49.95 [Camping Gear/Sleep System]
[d4e5f6] | 2026 | Salomon X Ultra 5 Mid GORE-TEX Hiking Boots | $190 [Hiking Gear/Footwear]`;

describe('buildSystemPrompt', () => {
  test('includes the agent persona', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toMatch(/personal outdoor companion/i);
    expect(allText).toMatch(/hiking|backpacking|mountain biking|climbing|skiing|paddling|surfing/i);
  });

  test('includes the compact inventory text verbatim', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toContain(SAMPLE_COMPACT_VIEW);
  });

  test('includes the REI preference instruction', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toMatch(/prefer REI/i);
    expect(allText).toMatch(/co-op member/i);
  });

  test('describes when to use get_product_url and update_status', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toContain('get_product_url');
    expect(allText).toContain('update_status');
  });

  test('marks the inventory block with cache_control: ephemeral', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const cached = blocks.filter((b) => b.cache_control?.type === 'ephemeral');
    expect(cached).toHaveLength(1);
    expect(cached[0]!.text).toContain(SAMPLE_COMPACT_VIEW);
  });

  test('returns blocks in a stable, deterministic order', () => {
    const a = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const b = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    expect(a).toEqual(b);
  });
});

function makeFakeAnthropic(scriptedResponses: Array<{
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>;
  stop_reason: 'end_turn' | 'tool_use';
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number };
}>) {
  let i = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const r = scriptedResponses[Math.min(i, scriptedResponses.length - 1)]!;
        i += 1;
        return r;
      }),
    },
  };
}

function makeAgentDeps(rows: MasterRow[]) {
  const cache = new InventoryCache(async () => rows);
  const conversations = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
  const stats = new Stats();
  return { cache, conversations, stats };
}

describe('OutdoorAgent.handleMessage', () => {
  test('returns the assistant text for a no-tool response', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'Hi Tom!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 4 },
      },
    ]);
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    const out = await agent.handleMessage('chat-1', 'hello');
    expect(out).toBe('Hi Tom!');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
    expect(stats.totalQueries).toBe(1);
    expect(stats.cacheHits).toBe(1);
  });

  test('executes a tool call and feeds the result back to the model', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tid = itemId(FIXTURE_THERMAREST);
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'get_product_url', input: { item_id: tid } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0, output_tokens: 12 },
      },
      {
        content: [{ type: 'text', text: 'Here it is: https://example.com/thermarest' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 10 },
      },
    ]);
    const updateRowStatus = vi.fn();
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: updateRowStatus as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    const out = await agent.handleMessage('chat-1', 'give me the link');
    expect(out).toBe('Here it is: https://example.com/thermarest');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
    const secondCallArgs = (anthropic.messages.create as any).mock.calls[1][0];
    const lastUserContent = secondCallArgs.messages.at(-1).content;
    expect(JSON.stringify(lastUserContent)).toContain('https://example.com/thermarest');
  });

  test('records cold vs. warm cache correctly via Stats', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'reply 1' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0, output_tokens: 4 },
      },
    ]);
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    await agent.handleMessage('chat-1', 'hi');
    expect(stats.coldWrites).toBe(1);
    expect(stats.cacheHits).toBe(0);
  });

  test('appends user + assistant messages to the conversation store', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'sure' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 1 },
      },
    ]);
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    await agent.handleMessage('chat-1', 'are you there?');
    const history = conversations.get('chat-1');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: 'user', content: 'are you there?' });
    expect(history[1]).toMatchObject({ role: 'assistant', content: 'sure' });
  });

  test('caps the tool-call loop at 8 iterations and throws if exceeded', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tid = itemId(FIXTURE_THERMAREST);
    const looping = {
      content: [{ type: 'tool_use' as const, id: 'tu_1', name: 'get_product_url', input: { item_id: tid } }],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 8 },
    };
    const anthropic = makeFakeAnthropic(Array.from({ length: 12 }, () => looping));
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    await expect(agent.handleMessage('chat-1', 'hi')).rejects.toThrow(/tool-call loop/i);
  });

  test('falls back to sonnet-4-6 when opus-4-7 returns sustained 529s', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const successResp = {
      content: [{ type: 'text', text: 'opus answered' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 5 },
    };
    const seenModels: string[] = [];
    const anthropic = {
      messages: {
        create: vi.fn(async (args: { model: string }) => {
          seenModels.push(args.model);
          if (args.model === 'claude-opus-4-7') {
            throw new Anthropic.APIError(
              529,
              { error: { type: 'overloaded_error', message: 'Overloaded' } } as never,
              'Overloaded',
              undefined,
            );
          }
          return successResp;
        }),
      },
    };
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    const out = await agent.handleMessage('chat-1', 'hi');
    expect(out).toBe('opus answered');
    const opusAttempts = seenModels.filter((m) => m === 'claude-opus-4-7');
    const sonnetAttempts = seenModels.filter((m) => m === 'claude-sonnet-4-6');
    expect(opusAttempts.length).toBeGreaterThanOrEqual(5); // primary retried fully first
    expect(sonnetAttempts.length).toBeGreaterThanOrEqual(1);
  }, 60000);

  test('retries the Anthropic call on a transient 529 Overloaded and recovers', async () => {
    const { cache, conversations, stats } = makeAgentDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    let callCount = 0;
    const successResp = {
      content: [{ type: 'text', text: 'second try worked' }],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 5 },
    };
    const anthropic = {
      messages: {
        create: vi.fn(async () => {
          callCount += 1;
          if (callCount === 1) {
            const Anthropic = (await import('@anthropic-ai/sdk')).default;
            throw new Anthropic.APIError(
              529,
              { error: { type: 'overloaded_error', message: 'Overloaded' } } as never,
              'Overloaded',
              undefined,
            );
          }
          return successResp;
        }),
      },
    };
    const agent = new OutdoorAgent({
      cache,
      conversations,
      stats,
      anthropic: anthropic as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['anthropic'],
      sheets: {} as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['sheets'],
      spreadsheetId: 'TEST',
      updateRowStatus: vi.fn() as unknown as ConstructorParameters<typeof OutdoorAgent>[0]['updateRowStatus'],
    });
    const out = await agent.handleMessage('chat-1', 'hi');
    expect(out).toBe('second try worked');
    expect(callCount).toBe(2);
  });
});
