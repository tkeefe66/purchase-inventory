import { describe, test, expect, vi } from 'vitest';
import { PhotographyAgent, buildSystemPrompt, buildProgressSummary } from '../../../domains/photography/agent.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { ConversationStore } from '../../../lib/conversations.js';
import { Stats } from '../../../apps/bot/stats.js';
import type { MasterRow } from '../../../lib/types.js';
import type { ProgressRow } from '../../../lib/photographySheets.js';

const FIXTURE_A6700: MasterRow = {
  year: '2024',
  date: '2024-09-15',
  category: 'Camera Bodies',
  subCategory: '',
  brand: 'Sony',
  itemName: 'Alpha a6700 Mirrorless Camera',
  color: '', size: '',
  qty: 1, price: 1499,
  source: 'Amazon',
  orderId: '111-1', status: 'active',
  domain: 'Photography',
  productUrl: 'https://amazon.com/dp/B0CC1234',
  type: 'Gear',
  reasoning: '', notes: '', image: '', entryMethod: 'email',
};

// ─── buildSystemPrompt ────────────────────────────────────────────────────

const EMPTY_SUMMARY = 'Curriculum state: 0 completed, 0 in progress, 58 not started — FRESH USER, run intake';

describe('buildSystemPrompt', () => {
  test('produces 5 blocks in stable order', () => {
    const blocks = buildSystemPrompt({ compactViewText: 'fake inventory', progressSummary: EMPTY_SUMMARY });
    expect(blocks).toHaveLength(5);
    expect(blocks[0]!.text).toContain('photography tutor');
    expect(blocks[1]!.text).toContain('fake inventory');
    expect(blocks[1]!.text).toContain('Curriculum state');
    expect(blocks[2]!.text).toContain('NO free-form photo critique');
    expect(blocks[3]!.text).toContain('get_sun_times');
    expect(blocks[4]!.text).toContain('Onboarding');
  });

  test('marks the inventory+progress block with cache_control: ephemeral', () => {
    const blocks = buildSystemPrompt({ compactViewText: 'x', progressSummary: EMPTY_SUMMARY });
    expect(blocks[1]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0]!.cache_control).toBeUndefined();
    expect(blocks[2]!.cache_control).toBeUndefined();
    expect(blocks[3]!.cache_control).toBeUndefined();
    expect(blocks[4]!.cache_control).toBeUndefined();
  });

  test('persona explicitly references Tom\'s gear', () => {
    const blocks = buildSystemPrompt({ compactViewText: '', progressSummary: '' });
    const persona = blocks[0]!.text;
    expect(persona).toContain('a6700');
    expect(persona).toContain('Sigma 18-50');
    expect(persona).toContain('70-350');
    expect(persona).toContain('ET-8550');
    expect(persona).toContain('Boulder');
  });

  test('scope block forbids free-form critique + autonomous topic completion', () => {
    const blocks = buildSystemPrompt({ compactViewText: '', progressSummary: '' });
    const scope = blocks[2]!.text;
    expect(scope).toMatch(/no free-form photo critique/i);
    expect(scope).toMatch(/no autonomous topic completion/i);
    expect(scope).toMatch(/no assignment generation/i);
  });

  test('onboarding block defines a 3-question intake and the routing logic', () => {
    const blocks = buildSystemPrompt({ compactViewText: '', progressSummary: '' });
    const onboarding = blocks[4]!.text;
    expect(onboarding).toMatch(/3-question intake/i);
    expect(onboarding).toMatch(/confidence with manual mode/i);
    expect(onboarding).toMatch(/none \/ shaky \/ decent \/ strong/);
    expect(onboarding).toMatch(/realistic shooting cadence/i);
    // Routing logic
    expect(onboarding).toMatch(/strong.*\/start operating-camera\.manual-mode/);
    expect(onboarding).toMatch(/exposure-triangle/);
    expect(onboarding).toMatch(/aperture-priority/);
    // One-shot rule
    expect(onboarding).toMatch(/never re-run.*intake/i);
  });
});

// ─── buildProgressSummary ─────────────────────────────────────────────────

const PROGRESS_FRESH: ProgressRow[] = [];
function progRow(topicId: string, status: ProgressRow['status']): ProgressRow {
  return {
    rowIndex: 1, topicId, status,
    lastActivityAt: '2026-05-19T15:00:00Z',
    assignmentsPassed: status === 'completed' ? 1 : 0,
    assignmentsFailed: 0,
    theoryLastReadAt: '',
  };
}

describe('buildProgressSummary', () => {
  test('flags FRESH USER when nothing completed/in-progress and no active', () => {
    const summary = buildProgressSummary(PROGRESS_FRESH, null);
    expect(summary).toContain('FRESH USER');
    expect(summary).toContain('0 completed');
    expect(summary).toContain('0 in progress');
  });

  test('does NOT flag FRESH USER when there is an active assignment', () => {
    const summary = buildProgressSummary(PROGRESS_FRESH, 'operating-camera.exposure-triangle');
    expect(summary).not.toContain('FRESH USER');
    expect(summary).toContain('active assignment: operating-camera.exposure-triangle');
  });

  test('does NOT flag FRESH USER once any topic is completed', () => {
    const summary = buildProgressSummary(
      [progRow('operating-camera.exposure-triangle', 'completed')],
      null,
    );
    expect(summary).not.toContain('FRESH USER');
    expect(summary).toContain('1 completed');
  });

  test('does NOT flag FRESH USER once any topic is in-progress', () => {
    const summary = buildProgressSummary(
      [progRow('operating-camera.exposure-triangle', 'in-progress')],
      null,
    );
    expect(summary).not.toContain('FRESH USER');
    expect(summary).toContain('1 in progress');
  });
});

// ─── PhotographyAgent.handleMessage ───────────────────────────────────────

function makeFakeAnthropic(scripted: Array<{
  content: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown }>;
  stop_reason: 'end_turn' | 'tool_use';
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number };
}>) {
  let i = 0;
  return {
    messages: {
      create: vi.fn(async () => {
        const r = scripted[Math.min(i, scripted.length - 1)]!;
        i += 1;
        return r;
      }),
    },
  };
}

function makeAgent(anthropic: ReturnType<typeof makeFakeAnthropic>, toolOverrides: Partial<ConstructorParameters<typeof PhotographyAgent>[0]['toolDeps']> = {}) {
  const cache = new InventoryCache(async () => [FIXTURE_A6700]);
  const conversations = new ConversationStore({ idleTtlMs: 30 * 60 * 1000 });
  const stats = new Stats();
  const agent = new PhotographyAgent({
    cache,
    conversations,
    stats,
    anthropic: anthropic as unknown as ConstructorParameters<typeof PhotographyAgent>[0]['anthropic'],
    toolDeps: {
      weather: {
        getForecast: vi.fn(async () => ({
          resolved: { name: 'Boulder, CO', lat: 40, lon: -105.27, timezone: 'America/Denver' },
          daily: [], hourlyTomorrow: [],
        })),
      },
      geocode: vi.fn(async (place: string) => ({ lat: 40.014, lon: -105.27, name: place })),
      getActiveAssignment: vi.fn(async () => null),
      readProgress: vi.fn(async () => []),
      expanderDeps: { anthropic: anthropic as never, inventoryText: '' },
      ...toolOverrides,
    },
  });
  return { agent, cache, conversations, stats };
}

describe('PhotographyAgent.handleMessage', () => {
  test('returns the assistant text for a no-tool response', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'Golden hour in Boulder Saturday is around 7:45 PM MT.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 15 },
      },
    ]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    const out = await agent.handleMessage('chat-1', 'when is golden hour Saturday?');
    expect(out).toContain('Golden hour');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(1);
  });

  test('executes a tool call (list_topics) and feeds result back to model', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'list_topics', input: { branch: 'seeing', status: 'available' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, cache_creation_input_tokens: 2400, cache_read_input_tokens: 0, output_tokens: 12 },
      },
      {
        content: [{ type: 'text', text: 'Three available in Seeing: composition-fundamentals, light-quality, subject-and-story.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 20 },
      },
    ]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    const out = await agent.handleMessage('chat-1', 'what can I learn in seeing?');
    expect(out).toContain('composition-fundamentals');
    expect(anthropic.messages.create).toHaveBeenCalledTimes(2);
  });

  test('builds the request with TOOL_SCHEMAS + web_search server tool', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 1 },
      },
    ]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('chat-1', 'hi');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { tools: Array<{ name: string }> };
    const toolNames = call.tools.map((t) => t.name);
    expect(toolNames).toContain('get_forecast');
    expect(toolNames).toContain('get_sun_times');
    expect(toolNames).toContain('list_topics');
    expect(toolNames).toContain('web_search');
  });

  test('appends user + assistant messages to the conversation store', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'Sure thing.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 1 },
      },
    ]);
    const { agent, cache, conversations } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('chat-1', 'hi');
    const history = conversations.get('chat-1');
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe('user');
    expect(history[1]!.role).toBe('assistant');
  });

  test('records cache hit metrics via Stats', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 2400, output_tokens: 4 },
      },
    ]);
    const { agent, cache, stats } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('chat-1', 'hi');
    expect(stats.totalQueries).toBe(1);
    expect(stats.cacheHits).toBe(1);
  });

  test('serializes only Domain=Photography rows into the prompt', async () => {
    const rowOutdoor: MasterRow = { ...FIXTURE_A6700, domain: 'Outdoor', itemName: 'Patagonia Houdini' };
    const rowPhoto: MasterRow = { ...FIXTURE_A6700, itemName: 'Sigma 18-50' };
    const cache = new InventoryCache(async () => [rowOutdoor, rowPhoto]);
    await cache.refresh();
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 1, output_tokens: 1 },
      },
    ]);
    const agent = new PhotographyAgent({
      cache,
      conversations: new ConversationStore({ idleTtlMs: 60_000 }),
      stats: new Stats(),
      anthropic: anthropic as unknown as ConstructorParameters<typeof PhotographyAgent>[0]['anthropic'],
      toolDeps: {
        weather: { getForecast: vi.fn() as never },
        geocode: vi.fn() as never,
        getActiveAssignment: vi.fn(async () => null),
        readProgress: vi.fn(async () => []),
        expanderDeps: { anthropic: anthropic as never, inventoryText: '' },
      },
    });
    await agent.handleMessage('chat-1', 'hi');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { system: Array<{ text: string }> };
    const inventoryBlock = call.system[1]!.text;
    expect(inventoryBlock).toContain('Sigma 18-50');
    expect(inventoryBlock).not.toContain('Patagonia Houdini');
    // The same block also carries the curriculum progress summary
    expect(inventoryBlock).toContain('Curriculum state');
  });

  test('embeds FRESH USER tag when progress + active are both empty', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'Welcome — intake time.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 1, output_tokens: 1 },
      },
    ]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('chat-1', 'hi');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { system: Array<{ text: string }> };
    const inventoryBlock = call.system[1]!.text;
    expect(inventoryBlock).toContain('FRESH USER');
  });

  test('does NOT embed FRESH USER when an active assignment exists', async () => {
    const anthropic = makeFakeAnthropic([
      {
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 1, output_tokens: 1 },
      },
    ]);
    const { agent, cache } = makeAgent(anthropic, {
      getActiveAssignment: vi.fn(async () => ({
        rowIndex: 5, id: 'asgn-1', dateIssued: '', dateSubmitted: '', dateGraded: '',
        topicId: 'operating-camera.aperture-priority', assignmentText: '', rubricJson: '[]',
        status: 'active' as const,
        submittedPhotoTelegramFileId: '', camera: '', lens: '', settingsExtracted: '',
        aiVerdict: '' as const, aiCritique: '', perCriterionJson: '', retryCount: 0,
        userNotes: '', skippedReason: '',
      })),
    });
    await cache.refresh();
    await agent.handleMessage('chat-1', 'hi');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { system: Array<{ text: string }> };
    const inventoryBlock = call.system[1]!.text;
    expect(inventoryBlock).not.toContain('FRESH USER');
    expect(inventoryBlock).toContain('active assignment: operating-camera.aperture-priority');
  });
});
