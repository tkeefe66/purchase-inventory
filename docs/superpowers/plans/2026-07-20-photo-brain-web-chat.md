# Photo Brain Web Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Tom chat with the photography agent ("photo brain") from the web dashboard via a slide-over drawer that knows which topic page he's viewing.

**Architecture:** One shared `PhotographyAgent` parameterized by surface (`'telegram' | 'web'`). A new `PhotoBrainChatService` (domain layer) owns validation + busy-guard + topic resolution; a `globalThis` singleton in `app/lib/photo-brain.ts` wires it with web-side deps; a new `/api/photography/chat` route (GET/POST/DELETE) fronts it; a portal-rendered drawer component mounts from the photography sub-nav. Two cost controls (history trim, message cache breakpoint, plus moving the system cache breakpoint to the last static block) land in the shared agent and benefit Telegram too.

**Tech Stack:** TypeScript 5 strict, Next.js 14 App Router, `@anthropic-ai/sdk`, vitest, Tailwind (existing token classes), `marked` via existing `Markdown` component.

**Spec:** `docs/superpowers/specs/2026-07-20-photo-brain-web-chat-design.md`

## Global Constraints

- Telegram system-prompt **text** must remain byte-identical for `surface: 'telegram'` (cache-breakpoint *placement* may change; text may not).
- `domains/` imports from `lib/` only — Task 1 removes the existing `domains/photography → apps/bot` type imports; do not add new ones.
- NodeNext import style (`.js` suffix) in `domains/`, `lib/`, `tests/`; bundler style (no suffix for app-internal imports, `.js` suffix for repo-root `lib/`/`domains/` imports, matching existing `app/` files) in `app/`.
- `MAX_TOKENS = 1024`, `MAX_TOOL_LOOPS = 8`, model chain (Opus 4.7 → Sonnet → Haiku on 529) unchanged.
- No new npm dependencies.
- Chat is converse-only: no mutation tools; the prompt directs Tom to the UI buttons.
- Message limit: 4000 chars. History sent to the model: last 30 messages. Conversation key: `'web'`. Idle TTL: 30 min.
- Run `npm run typecheck` and the photography test files after each task; commit per task.

---

### Task 1: Decouple agent deps (narrow interfaces)

`PhotographyAgent` currently imports `InventoryCache` and `Stats` from `apps/bot/`. Replace those nominal types with structural interfaces so the web app can construct the agent without bot code. Zero behavior change; bot wiring compiles unchanged via structural typing.

**Files:**
- Modify: `domains/photography/agent.ts:14-19, 172-178`
- Test: existing `tests/domains/photography/agent.test.ts` (must stay green unchanged)

**Interfaces:**
- Consumes: `MasterRow` from `lib/types.ts`
- Produces: `InventorySnapshotProvider { getSnapshot(): readonly MasterRow[] }`, `AgentQueryMetrics`, `AgentStats { recordQuery(m: AgentQueryMetrics): void }` — Tasks 5/6 rely on these exact names.

- [ ] **Step 1: Replace the imports and option types**

In `domains/photography/agent.ts`, delete these two imports:

```ts
import type { InventoryCache } from '../../apps/bot/inventoryCache.js';
import { Stats } from '../../apps/bot/stats.js';
```

Add after the remaining imports:

```ts
import type { MasterRow } from '../../lib/types.js';

export interface InventorySnapshotProvider {
  getSnapshot(): readonly MasterRow[];
}

export interface AgentQueryMetrics {
  systemPromptTokens: number;
  cacheHit: boolean;
  firstTokenMs: number;
  totalResponseMs: number;
}

export interface AgentStats {
  recordQuery(m: AgentQueryMetrics): void;
}
```

Change `PhotographyAgentOptions`:

```ts
export interface PhotographyAgentOptions {
  cache: InventorySnapshotProvider;
  conversations: ConversationStore;
  stats: AgentStats;
  anthropic: Anthropic;
  toolDeps: ToolDeps;
}
```

- [ ] **Step 2: Verify nothing broke**

Run: `npm run typecheck`
Expected: both tsconfigs pass (bot's `InventoryCache`/`Stats` satisfy the interfaces structurally).

Run: `npx vitest run tests/domains/photography/agent.test.ts`
Expected: all existing tests PASS unchanged.

- [ ] **Step 3: Commit**

```bash
git add domains/photography/agent.ts
git commit -m "refactor(photography): narrow agent deps to structural interfaces"
```

---

### Task 2: Surface parameterization of the system prompt

Add `surface: 'telegram' | 'web'`. Telegram text stays byte-identical; web variants swap Telegram/slash-command guidance for topic-page-button guidance.

**Files:**
- Modify: `domains/photography/agent.ts` (prompt constants, `SystemPromptInput`, `buildSystemPrompt`, `PhotographyAgentOptions`, `handleMessage`)
- Test: `tests/domains/photography/agent.test.ts`

**Interfaces:**
- Produces: `type AgentSurface = 'telegram' | 'web'`; `SystemPromptInput` gains optional `surface?: AgentSurface` (default `'telegram'`); `PhotographyAgentOptions` gains optional `surface?: AgentSurface`. Task 6 constructs the agent with `surface: 'web'`.

- [ ] **Step 1: Write the failing tests**

Append to the `buildSystemPrompt` describe block in `tests/domains/photography/agent.test.ts`:

```ts
  test("default surface is byte-identical to explicit 'telegram'", () => {
    const a = buildSystemPrompt({ compactViewText: 'x', progressSummary: 'y' });
    const b = buildSystemPrompt({ compactViewText: 'x', progressSummary: 'y', surface: 'telegram' });
    expect(b).toEqual(a);
  });

  test('web surface swaps slash commands for topic-page buttons', () => {
    const blocks = buildSystemPrompt({ compactViewText: 'x', progressSummary: 'y', surface: 'web' });
    expect(blocks).toHaveLength(5);
    const all = blocks.map((b) => b.text).join('\n');
    expect(all).not.toMatch(/`\/(start|learn|skip|outdoor)/);
    expect(all).not.toContain('Telegram renders Markdown');
    expect(all).toContain('Start');
    expect(all).toMatch(/Learn/);
    expect(all).toMatch(/button/i);
  });

  test('web surface keeps the shared persona, scope rules, and intake', () => {
    const blocks = buildSystemPrompt({ compactViewText: 'x', progressSummary: 'y', surface: 'web' });
    expect(blocks[0]!.text).toContain('a6700');
    expect(blocks[2]!.text).toMatch(/no free-form photo critique/i);
    expect(blocks[3]!.text).toContain('get_sun_times');
    expect(blocks[4]!.text).toMatch(/3-question intake/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/photography/agent.test.ts`
Expected: FAIL — `surface` not accepted / web variants missing.

- [ ] **Step 3: Implement the surface variants**

In `domains/photography/agent.ts`:

Add the type and extend the input:

```ts
export type AgentSurface = 'telegram' | 'web';

export interface SystemPromptInput {
  /** Compact view of Tom's active photography inventory, embedded into the prompt. */
  compactViewText: string;
  /** One-line curriculum state summary. */
  progressSummary: string;
  /** Which surface this conversation renders on. Default 'telegram'. */
  surface?: AgentSurface;
}
```

`PERSONA` today ends with the Telegram formatting paragraph. Split it so the shared body stays one source of truth and the closing paragraph varies (assemble so the `'telegram'` result is byte-identical to the current constant — the existing "persona explicitly references Tom's gear" test plus Step 1's equality test guard this):

```ts
const PERSONA_BODY = `You are Tom's photography tutor — patient, opinionated, gear-aware. Tom is a beginner who recently bought a serious mirrorless setup (Sony a6700 + Sigma 18-50 f/2.8 + Sony 70-350 + Epson ET-8550) specifically to learn photography. Your job in this conversation:

  - Teach photography concepts when asked.
  - Help him plan shoots around real conditions (weather, sun times, trails).
  - Reference his curriculum — what he's already done, what's next.
  - Reference his actual gear by name. Don't recommend gear he doesn't have.

Tone: direct, specific, occasionally dry. NO motivational filler. NO "have fun out there!". Treat Tom like a smart adult learning a craft.

Tom's home: Boulder, Colorado. Default location for forecasts / trails / sun-times unless he names another place.`;

const PERSONA = `${PERSONA_BODY}

Telegram renders Markdown. Use **bold** sparingly, \`code\` for commands and topic ids. Format slash commands as code: \`/start operating-camera.exposure-triangle\`.`;

const PERSONA_WEB = `${PERSONA_BODY}

You are chatting inside the web dashboard. Replies render as standard Markdown. Use **bold** sparingly and \`code\` for topic ids. All state changes happen through buttons in the UI, not chat: each topic page has Learn (theory), Start (create assignment), Skip, and Submit (photo grading) buttons. When Tom should take an action, point him at the right button on the right topic page.`;
```

Add the web scope variant after `SCOPE_GUARDRAILS`:

```ts
const SCOPE_GUARDRAILS_WEB = `**Scope:**

  - You handle photography topics: technique, gear (his gear), shoot planning, theory, post-processing concepts, printing. Outdoor questions (hiking, climbing, camping) should be redirected: "ask the outdoor agent in Telegram for that." Don't answer general programming / current events / unrelated questions — politely redirect ("That's outside what I help with — try a general-purpose Claude.").

  - **NO free-form photo critique.** If Tom asks "what do you think of this photo?" outside of an active assignment, redirect: "Start an assignment first (Start button on the topic page), then submit the photo there — that gets you a rubric-graded critique. Free-form critique isn't in scope yet."

  - **NO assignment generation in conversation.** Don't write assignment text or rubrics directly in your replies. Direct Tom to the Start button on the topic page — the assignment expander is the authoritative path. You CAN suggest WHICH topic to start (via list_topics), but the button does the writing.

  - **NO autonomous topic completion.** Don't tell Tom "I've marked X complete" — only the grading flow + UI buttons move state.`;
```

`TOOL_GUIDANCE` differs between surfaces in exactly one clause (the `/learn` alternative in the `get_topic_theory` bullet). Convert the constant to a template so the Telegram text can't drift:

```ts
function buildToolGuidance(theoryAlternative: string): string {
  return `You have these tools:

  - **web_search** (max 3/turn) — current gear info, current photo blogs, current paper availability, recent reviews. Skip for general photography knowledge (you have that). Cite the source domain when you do search.

  - **get_forecast(location, days?)** — for any "will it be clear?" or "what's the weather?" question. Days defaults to 7. Pair with get_sun_times when timing matters.

  - **lookup_trail(name, near_location?)** — when Tom names a specific trail / overlook ("what's Mt Sanitas like for sunset?").

  - **search_trails_nearby(location, radius_km?, activity?)** — when Tom asks "good spots near me for landscape / wildlife". Suggest 3-5 of the closest with map links.

  - **get_sun_times(location, date?)** — ESSENTIAL for any "when should I shoot golden hour?" or "what time is sunset Saturday?" question. Date defaults to today. Convert UTC timestamps to Mountain Time in your reply (Tom's in Boulder; "5:42 PM MT" not "23:42 UTC").

  - **get_active_assignment()** — when Tom asks "what am I working on?" or you need context about his current assignment for targeted advice.

  - **list_topics(branch?, tier?, status?)** — when Tom asks "what should I learn next?" or wants to browse. Use sparingly — return 3-8 relevant topics in your reply, not all 58.

  - **get_topic_theory(topic_id)** — only when Tom specifically wants a deep dive on one topic in conversation. ${theoryAlternative}

Use tools sparingly. Combine multiple in parallel when relevant (e.g., forecast + sun-times + trails for "where should I shoot Saturday morning?"). Don't call list_topics every turn — only when the question is genuinely about curriculum navigation.`;
}

const TOOL_GUIDANCE = buildToolGuidance(
  'Usually he should run `/learn <id>` instead — mention that as a faster alternative.',
);
const TOOL_GUIDANCE_WEB = buildToolGuidance(
  'Usually he should use the Learn button on the topic page instead — mention that as a faster alternative.',
);
```

> NOTE for implementer: the template's literal text must reproduce the current `TOOL_GUIDANCE` **exactly** for the Telegram argument — copy the existing constant, don't retype it. The Step 1 equality test plus the existing `get_sun_times` assertion are the guard. (In the real file the `/learn` clause is inside a template literal — escape backticks as needed.)

Add the web onboarding variant after `ONBOARDING_RULES`:

```ts
const ONBOARDING_RULES_WEB = `**Onboarding (FRESH USER intake):**

The curriculum state above includes a "FRESH USER" tag when Tom has zero completed AND zero in-progress topics AND no active assignment — meaning he's never used the photography domain before. When that tag is present AND the conversation history is empty (this is his first photography message), run a 3-question intake BEFORE doing anything else (no tool calls, no recommendations — just ask):

  1. "Welcome to photography mode. Quick intake — three questions. (1/3) How would you describe your confidence with manual mode today? Options: none / shaky / decent / strong."
  2. (After his answer) "(2/3) Anything specific you want to start with, or want me to pick the most logical first step?"
  3. (After his answer) "(3/3) What's a realistic shooting cadence? Options: every weekend / opportunistic / ramping up / not sure yet."

Then, based on his answers, propose ONE concrete next step, pointing at the topic page buttons (Tom always confirms by clicking — never claim you started anything):

  - confidence = strong → "Skip the basics; open \`operating-camera.manual-mode\` and hit Start (shoot Manual at f/8 / 1/250 / ISO 200 in mixed light)."
  - confidence = none or shaky → "Start with theory: open \`operating-camera.exposure-triangle\` and hit Learn, then Start for the first assignment."
  - confidence = decent → "Skip the very basics: open \`operating-camera.aperture-priority\` and hit Start."
  - If Tom named a specific topic → use list_topics to verify it exists; if prereqs are unmet, propose the most-foundational prereq instead.
  - Cadence answer informs your closing line ("ramping up → plan for 2-3 sessions a week; opportunistic → one a week is fine; weekend → one focused session each Saturday").

Onboarding is one-shot. After Tom takes his first action (any Start or Learn), the FRESH USER tag clears and normal flow resumes. NEVER re-run the intake once he's started anything.

If a FRESH USER asks a substantive question instead of saying "hi" (e.g., "what should I learn first?"), skip the formal three questions and just propose the entry point — they're effectively answering question 2 with their question.`;
```

Rewrite `buildSystemPrompt` to pick by surface (block order and cache placement unchanged in this task):

```ts
export function buildSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  const web = (input.surface ?? 'telegram') === 'web';
  return [
    { type: 'text', text: web ? PERSONA_WEB : PERSONA },
    {
      type: 'text',
      text: `Tom's active photography inventory:\n${input.compactViewText}\n\n${input.progressSummary}`,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: web ? SCOPE_GUARDRAILS_WEB : SCOPE_GUARDRAILS },
    { type: 'text', text: web ? TOOL_GUIDANCE_WEB : TOOL_GUIDANCE },
    { type: 'text', text: web ? ONBOARDING_RULES_WEB : ONBOARDING_RULES },
  ];
}
```

Thread the surface through the agent — add to `PhotographyAgentOptions`:

```ts
  /** Which surface this agent instance serves. Default 'telegram'. */
  surface?: AgentSurface;
```

and in `handleMessage`, change the `buildSystemPrompt` call to:

```ts
    const system = buildSystemPrompt({
      compactViewText,
      progressSummary,
      surface: this.opts.surface ?? 'telegram',
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/domains/photography/agent.test.ts`
Expected: PASS, including all pre-existing tests (byte-identical Telegram output).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected clean.

```bash
git add domains/photography/agent.ts tests/domains/photography/agent.test.ts
git commit -m "feat(photography): surface-parameterized system prompt (telegram/web)"
```

---

### Task 3: Page-context injection

`handleMessage` accepts an optional `viewingTopic`; when present, a per-turn **uncached** system block is appended so the agent knows what page Tom is on. Never persisted to history.

**Files:**
- Modify: `domains/photography/agent.ts` (`handleMessage` signature + body)
- Test: `tests/domains/photography/agent.test.ts`

**Interfaces:**
- Produces: `export interface HandleMessageOptions { viewingTopic?: { id: string; name: string } }`; `handleMessage(chatId: string, userText: string, opts?: HandleMessageOptions): Promise<string>`. Task 5's `ChatAgent` interface matches this exactly.

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `tests/domains/photography/agent.test.ts`:

```ts
describe('page-context injection', () => {
  const OK_RESPONSE = {
    content: [{ type: 'text' as const, text: 'ok' }],
    stop_reason: 'end_turn' as const,
    usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 1, output_tokens: 1 },
  };

  test('appends an uncached system block naming the viewed topic', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('web', 'what is this assignment asking for?', {
      viewingTopic: { id: 'operating-camera.panning', name: 'Panning' },
    });
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      system: Array<{ text: string; cache_control?: unknown }>;
    };
    expect(call.system).toHaveLength(6);
    const ctx = call.system[5]!;
    expect(ctx.text).toContain('Panning');
    expect(ctx.text).toContain('operating-camera.panning');
    expect(ctx.cache_control).toBeUndefined();
  });

  test('omits the context block when no viewingTopic is passed', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('web', 'hi');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { system: unknown[] };
    expect(call.system).toHaveLength(5);
  });

  test('page context never lands in conversation history', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache, conversations } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('web', 'hello', {
      viewingTopic: { id: 'operating-camera.panning', name: 'Panning' },
    });
    const history = conversations.get('web');
    expect(history).toHaveLength(2);
    expect(history[0]!.content).toBe('hello');
    expect(history[1]!.content).toBe('ok');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/photography/agent.test.ts`
Expected: FAIL — third argument not accepted / 6th block missing.

- [ ] **Step 3: Implement**

In `domains/photography/agent.ts`, add near `PhotographyAgentOptions`:

```ts
export interface HandleMessageOptions {
  /** Topic page the user is currently viewing in the web UI, if any. */
  viewingTopic?: { id: string; name: string };
}
```

Change the `handleMessage` signature:

```ts
  async handleMessage(chatId: string, userText: string, opts: HandleMessageOptions = {}): Promise<string> {
```

Immediately after the `const system = buildSystemPrompt(...)` line, add:

```ts
    if (opts.viewingTopic) {
      system.push({
        type: 'text',
        text: `Current page context: Tom is viewing the topic page for "${opts.viewingTopic.name}" (${opts.viewingTopic.id}). When he says "this assignment" or "this topic", he most likely means this one.`,
      });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/domains/photography/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected clean.

```bash
git add domains/photography/agent.ts tests/domains/photography/agent.test.ts
git commit -m "feat(photography): per-turn page-context injection for web chat"
```

---

### Task 4: Cost controls (history trim + cache breakpoints)

Three changes to the shared agent, benefiting both surfaces: (a) move the system cache breakpoint from the volatile inventory block to the last static block so all five blocks ride the cache; (b) trim request history to the last 30 messages; (c) add a message-level cache breakpoint so tool-loop iterations 2..N read the prior prefix at 0.1× price.

**Files:**
- Modify: `domains/photography/agent.ts` (`buildSystemPrompt`, `handleMessage`, `callWithModelFallback`, new helper)
- Test: `tests/domains/photography/agent.test.ts` (one existing test updated + new tests)

**Interfaces:**
- Produces: exported `const MAX_HISTORY_MESSAGES = 30` (Task 5 does not consume it, but tests do). No signature changes.

- [ ] **Step 1: Update the existing cache-placement test and write the new failing tests**

In `tests/domains/photography/agent.test.ts`, **replace** the body of the existing test `'marks the inventory+progress block with cache_control: ephemeral'` with (and rename it):

```ts
  test('marks the last static block with cache_control: ephemeral', () => {
    const blocks = buildSystemPrompt({ compactViewText: 'x', progressSummary: EMPTY_SUMMARY });
    expect(blocks[4]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks[0]!.cache_control).toBeUndefined();
    expect(blocks[1]!.cache_control).toBeUndefined();
    expect(blocks[2]!.cache_control).toBeUndefined();
    expect(blocks[3]!.cache_control).toBeUndefined();
  });
```

Append a new describe block:

```ts
describe('cost controls', () => {
  const OK_RESPONSE = {
    content: [{ type: 'text' as const, text: 'ok' }],
    stop_reason: 'end_turn' as const,
    usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 1, output_tokens: 1 },
  };

  test('sends at most the last 30 history messages (plus the new user turn)', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache, conversations } = makeAgent(anthropic);
    await cache.refresh();
    for (let i = 0; i < 20; i += 1) {
      conversations.append('web', { role: 'user', content: `q${i}` });
      conversations.append('web', { role: 'assistant', content: `a${i}` });
    }
    await agent.handleMessage('web', 'latest question');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(call.messages).toHaveLength(31);
    expect(call.messages[0]!.role).toBe('user');
    // Oldest surviving pair is q5/a5 (40 stored, last 30 kept). History
    // messages stay plain strings — only the final message is normalized
    // to block form by the breakpoint helper.
    expect(call.messages[0]!.content).toBe('q5');
  });

  test('marks the last block of the last message with cache_control', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('web', 'hi');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ cache_control?: unknown }> }>;
    };
    const lastMsg = call.messages[call.messages.length - 1]!;
    const lastBlock = lastMsg.content[lastMsg.content.length - 1]!;
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });
  });

  test('earlier messages carry no cache_control (single message breakpoint)', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache, conversations } = makeAgent(anthropic);
    await cache.refresh();
    conversations.append('web', { role: 'user', content: 'old q' });
    conversations.append('web', { role: 'assistant', content: 'old a' });
    await agent.handleMessage('web', 'new q');
    const call = (anthropic.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      messages: Array<{ content: unknown }>;
    };
    const flagged = call.messages.filter((m) =>
      Array.isArray(m.content) && (m.content as Array<{ cache_control?: unknown }>).some((b) => b.cache_control),
    );
    expect(flagged).toHaveLength(1);
  });

  test('does not mutate stored conversation content when adding breakpoints', async () => {
    const anthropic = makeFakeAnthropic([OK_RESPONSE]);
    const { agent, cache, conversations } = makeAgent(anthropic);
    await cache.refresh();
    await agent.handleMessage('web', 'first');
    await agent.handleMessage('web', 'second');
    const history = conversations.get('web');
    expect(history.every((m) => typeof m.content === 'string')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/domains/photography/agent.test.ts`
Expected: the four new tests + the renamed placement test FAIL; others PASS.

- [ ] **Step 3: Implement**

In `domains/photography/agent.ts`:

(a) In `buildSystemPrompt`, move `cache_control: { type: 'ephemeral' }` from the inventory block (index 1) to the last block (index 4):

```ts
export function buildSystemPrompt(input: SystemPromptInput): SystemBlock[] {
  const web = (input.surface ?? 'telegram') === 'web';
  return [
    { type: 'text', text: web ? PERSONA_WEB : PERSONA },
    {
      type: 'text',
      text: `Tom's active photography inventory:\n${input.compactViewText}\n\n${input.progressSummary}`,
    },
    { type: 'text', text: web ? SCOPE_GUARDRAILS_WEB : SCOPE_GUARDRAILS },
    { type: 'text', text: web ? TOOL_GUIDANCE_WEB : TOOL_GUIDANCE },
    {
      type: 'text',
      text: web ? ONBOARDING_RULES_WEB : ONBOARDING_RULES,
      cache_control: { type: 'ephemeral' },
    },
  ];
}
```

(The Task 3 page-context block is pushed **after** this breakpoint, so per-turn context never invalidates the cached prefix.)

(b) Export the trim constant next to `MAX_TOKENS`:

```ts
export const MAX_HISTORY_MESSAGES = 30;
```

In `handleMessage`, replace the history lines:

```ts
    let history = this.opts.conversations.get(chatId).slice(-MAX_HISTORY_MESSAGES);
    // Anthropic requires the first message to be a user turn; if the trim cut
    // a pair in half, drop the leading assistant message.
    if (history[0]?.role === 'assistant') history = history.slice(1);
    const messages: AnthropicMessage[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userText },
    ];
```

(c) Add a module-level helper above the class:

```ts
type ContentBlock = { type: string; [key: string]: unknown };

/**
 * Return a shallow-copied messages array whose final content block carries a
 * cache breakpoint, so tool-loop iterations re-read the whole prior prefix
 * (system + history + earlier tool turns) from cache instead of re-billing it.
 * The last message before any API call is always a user turn (fresh text or
 * tool_results) — both block types accept cache_control. Originals are never
 * mutated, so stored history stays plain.
 */
function withMessageCacheBreakpoint(messages: AnthropicMessage[]): AnthropicMessage[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  const blocks: ContentBlock[] =
    typeof last.content === 'string'
      ? [{ type: 'text', text: last.content }]
      : (last.content as ContentBlock[]).map((b) => ({ ...b }));
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock) lastBlock['cache_control'] = { type: 'ephemeral' };
  return [...messages.slice(0, -1), { role: last.role, content: blocks }];
}
```

In `callWithModelFallback`, apply it:

```ts
    const baseArgs = {
      max_tokens: MAX_TOKENS,
      system,
      messages: withMessageCacheBreakpoint(messages) as Anthropic.Messages.MessageParam[],
      tools: [...TOOL_SCHEMAS, ...SERVER_TOOLS] as unknown as Anthropic.Messages.Tool[],
    };
```

- [ ] **Step 4: Run the full photography suite**

Run: `npx vitest run tests/domains/photography/`
Expected: all PASS (including tools/expander/grading — untouched).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected clean.

```bash
git add domains/photography/agent.ts tests/domains/photography/agent.test.ts
git commit -m "feat(photography): agent cost controls — history trim + message cache breakpoint"
```

---

### Task 5: PhotoBrainChatService (domain layer)

Surface-agnostic chat orchestration: message validation, one-turn-at-a-time busy guard, topicId → viewingTopic resolution, history/clear passthrough. Lives in `domains/photography/` so it is testable under the NodeNext tsconfig (the `app/` singleton in Task 6 stays thin and untested).

**Files:**
- Create: `domains/photography/chatService.ts`
- Test: `tests/domains/photography/chatService.test.ts`

**Interfaces:**
- Consumes: `HandleMessageOptions` shape from Task 3; `getTopicById` from `./skillTree.js`; `ConversationStore`, `ChatMessage` from `lib/conversations.ts`.
- Produces (Task 6 consumes all of these): `CHAT_MESSAGE_MAX_CHARS = 4000`; `class ChatBusyError`; `class InvalidMessageError`; `class PhotoBrainChatService { constructor(agent: ChatAgent, conversations: ConversationStore, chatId?: string); send(rawMessage: string, topicId?: string): Promise<string>; history(): ChatMessage[]; clear(): void }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/domains/photography/chatService.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import {
  PhotoBrainChatService,
  ChatBusyError,
  InvalidMessageError,
  CHAT_MESSAGE_MAX_CHARS,
} from '../../../domains/photography/chatService.js';
import { ConversationStore } from '../../../lib/conversations.js';

function makeService(handleMessage = vi.fn(async () => 'reply')) {
  const conversations = new ConversationStore({ idleTtlMs: 60_000 });
  const service = new PhotoBrainChatService({ handleMessage }, conversations);
  return { service, conversations, handleMessage };
}

describe('PhotoBrainChatService.send', () => {
  test('passes the trimmed message and resolved viewingTopic to the agent', async () => {
    const { service, handleMessage } = makeService();
    const reply = await service.send('  what is this assignment?  ', 'operating-camera.exposure-triangle');
    expect(reply).toBe('reply');
    expect(handleMessage).toHaveBeenCalledWith('web', 'what is this assignment?', {
      viewingTopic: { id: 'operating-camera.exposure-triangle', name: expect.any(String) },
    });
  });

  test('omits viewingTopic for an unknown topicId (e.g. the "assignments" path segment)', async () => {
    const { service, handleMessage } = makeService();
    await service.send('hello', 'assignments');
    expect(handleMessage).toHaveBeenCalledWith('web', 'hello', {});
  });

  test('omits viewingTopic when no topicId is given', async () => {
    const { service, handleMessage } = makeService();
    await service.send('hello');
    expect(handleMessage).toHaveBeenCalledWith('web', 'hello', {});
  });

  test('rejects empty and whitespace-only messages', async () => {
    const { service } = makeService();
    await expect(service.send('')).rejects.toThrow(InvalidMessageError);
    await expect(service.send('   ')).rejects.toThrow(InvalidMessageError);
  });

  test('rejects messages over the char limit', async () => {
    const { service } = makeService();
    await expect(service.send('x'.repeat(CHAT_MESSAGE_MAX_CHARS + 1))).rejects.toThrow(InvalidMessageError);
  });

  test('rejects a second send while one is in flight, then accepts after it settles', async () => {
    let resolveFirst!: (v: string) => void;
    const handleMessage = vi.fn(() => new Promise<string>((res) => { resolveFirst = res; }));
    const { service } = makeService(handleMessage as never);
    const first = service.send('one');
    await expect(service.send('two')).rejects.toThrow(ChatBusyError);
    resolveFirst('done');
    await expect(first).resolves.toBe('done');
    (handleMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => 'ok');
    await expect(service.send('three')).resolves.toBe('ok');
  });

  test('releases the busy guard when the agent throws', async () => {
    const handleMessage = vi.fn(async () => { throw new Error('boom'); });
    const { service } = makeService(handleMessage as never);
    await expect(service.send('one')).rejects.toThrow('boom');
    (handleMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => 'ok');
    await expect(service.send('two')).resolves.toBe('ok');
  });
});

describe('history / clear', () => {
  test('exposes and clears the web conversation', () => {
    const { service, conversations } = makeService();
    conversations.append('web', { role: 'user', content: 'q' });
    conversations.append('web', { role: 'assistant', content: 'a' });
    expect(service.history()).toHaveLength(2);
    service.clear();
    expect(service.history()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/domains/photography/chatService.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `domains/photography/chatService.ts`:

```ts
/**
 * Web-chat orchestration for the photography agent: message validation,
 * one-turn-at-a-time busy guard, and topic-page context resolution.
 * Surface wiring (Anthropic client, sheets, env) lives in app/lib/photo-brain.ts;
 * this stays dependency-injected so it is unit-testable.
 */

import { getTopicById } from './skillTree.js';
import type { ConversationStore, ChatMessage } from '../../lib/conversations.js';
import type { HandleMessageOptions } from './agent.js';

export const CHAT_MESSAGE_MAX_CHARS = 4000;

export class ChatBusyError extends Error {
  constructor() { super('A chat turn is already in flight.'); }
}

export class InvalidMessageError extends Error {
  constructor(reason: string) { super(reason); }
}

export interface ChatAgent {
  handleMessage(chatId: string, userText: string, opts?: HandleMessageOptions): Promise<string>;
}

export class PhotoBrainChatService {
  private inFlight = false;

  constructor(
    private readonly agent: ChatAgent,
    private readonly conversations: ConversationStore,
    private readonly chatId: string = 'web',
  ) {}

  history(): ChatMessage[] {
    return this.conversations.get(this.chatId);
  }

  clear(): void {
    this.conversations.clear(this.chatId);
  }

  async send(rawMessage: string, topicId?: string): Promise<string> {
    const message = rawMessage.trim();
    if (!message) throw new InvalidMessageError('Message is empty.');
    if (message.length > CHAT_MESSAGE_MAX_CHARS) {
      throw new InvalidMessageError(`Message exceeds ${CHAT_MESSAGE_MAX_CHARS} characters.`);
    }
    if (this.inFlight) throw new ChatBusyError();
    this.inFlight = true;
    try {
      const topic = topicId ? getTopicById(topicId) : undefined;
      const opts: HandleMessageOptions = topic
        ? { viewingTopic: { id: topic.id, name: topic.name } }
        : {};
      return await this.agent.handleMessage(this.chatId, message, opts);
    } finally {
      this.inFlight = false;
    }
  }
}
```

(If `ConversationStore`/`ChatMessage` aren't both exported as types compatible with this import, check `lib/conversations.ts` — both are exported today.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/domains/photography/chatService.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected clean.

```bash
git add domains/photography/chatService.ts tests/domains/photography/chatService.test.ts
git commit -m "feat(photography): PhotoBrainChatService — validation, busy guard, page context"
```

---

### Task 6: Web singleton + chat API route

Thin wiring: a `globalThis` singleton constructing the web-surface agent with real deps, and the `/api/photography/chat` route (GET / POST / DELETE). Logic already tested in Tasks 2-5; these files follow the existing untested-route convention.

**Files:**
- Create: `app/lib/photo-brain.ts`
- Create: `app/api/photography/chat/route.ts`

**Interfaces:**
- Consumes: `PhotographyAgent` (with `surface`, `InventorySnapshotProvider`, `AgentStats` from Tasks 1-2), `PhotoBrainChatService` + error classes from Task 5, `createSheetsClient`/`readMasterRows` from `lib/sheets.ts`, `getActiveAssignment`/`readProgress` from `lib/photographySheets.ts`, `createWeatherClient`/`geocode` from `lib/integrations/weather.ts`, `filterToActivePhotography`/`serializeCompact` from the photography domain.
- Produces: `getPhotoBrain(): { send(message: string, topicId?: string): Promise<string>; history(): ChatMessage[]; clear(): void }` — Task 7's drawer calls the route, not this.

- [ ] **Step 1: Create the singleton**

Create `app/lib/photo-brain.ts` (import suffix style: `.js` for repo-root `lib/`/`domains/` imports, matching `app/lib/photography-data.ts`):

```ts
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { PhotographyAgent } from '../../domains/photography/agent.js';
import { PhotoBrainChatService } from '../../domains/photography/chatService.js';
import { filterToActivePhotography } from '../../domains/photography/inventory.js';
import { serializeCompact } from '../../domains/photography/serialize.js';
import { ConversationStore, type ChatMessage } from '../../lib/conversations.js';
import { createSheetsClient, readMasterRows } from '../../lib/sheets.js';
import { getActiveAssignment, readProgress } from '../../lib/photographySheets.js';
import { createWeatherClient, geocode } from '../../lib/integrations/weather.js';
import type { MasterRow } from '../../lib/types.js';

const IDLE_TTL_MS = 30 * 60 * 1000;
const INVENTORY_TTL_MS = 30_000;

export interface PhotoBrain {
  send(message: string, topicId?: string): Promise<string>;
  history(): ChatMessage[];
  clear(): void;
}

function createPhotoBrain(): PhotoBrain {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const weather = createWeatherClient({ apiKey: process.env.PIRATE_WEATHER_API_KEY! });

  let snapshot: MasterRow[] = [];
  let lastFetchMs = 0;
  const ensureInventory = async (): Promise<void> => {
    if (Date.now() - lastFetchMs < INVENTORY_TTL_MS) return;
    snapshot = await readMasterRows(sheets, spreadsheetId);
    lastFetchMs = Date.now();
  };

  const conversations = new ConversationStore({ idleTtlMs: IDLE_TTL_MS });
  const agent = new PhotographyAgent({
    surface: 'web',
    cache: { getSnapshot: () => snapshot },
    conversations,
    stats: {
      recordQuery: (m) => console.log('[photo-brain] query', JSON.stringify(m)),
    },
    anthropic,
    toolDeps: {
      weather,
      geocode,
      getActiveAssignment: () => getActiveAssignment(sheets, spreadsheetId),
      readProgress: () => readProgress(sheets, spreadsheetId),
      expanderDeps: {
        anthropic,
        get inventoryText() {
          return serializeCompact(filterToActivePhotography(snapshot)).text;
        },
      },
    },
  });
  const service = new PhotoBrainChatService(agent, conversations);

  return {
    async send(message, topicId) {
      // Stale-but-present inventory beats a failed turn; log and continue.
      await ensureInventory().catch((err) => {
        console.error('[photo-brain] inventory refresh failed:', err);
      });
      return service.send(message, topicId);
    },
    history: () => service.history(),
    clear: () => service.clear(),
  };
}

// globalThis so Next dev hot-reload doesn't spawn duplicate stores/agents.
const g = globalThis as typeof globalThis & { __photoBrain?: PhotoBrain };

export function getPhotoBrain(): PhotoBrain {
  g.__photoBrain ??= createPhotoBrain();
  return g.__photoBrain;
}
```

> NOTE for implementer: check the exact export names in `lib/sheets.ts` (`readMasterRows`) and `lib/integrations/weather.ts` (`createWeatherClient`, `geocode`) before wiring — all verified present as of plan-writing. `expanderDeps.inventoryText` is a getter, matching the bot's wiring in `apps/bot/index.ts:157-164`.

- [ ] **Step 2: Create the route**

Create `app/api/photography/chat/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getPhotoBrain } from '../../../lib/photo-brain';
import {
  ChatBusyError,
  InvalidMessageError,
} from '../../../../domains/photography/chatService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ messages: getPhotoBrain().history() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { message?: string; topicId?: string };
  try {
    body = (await req.json()) as { message?: string; topicId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.message !== 'string') {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }
  console.log(
    `[api/photography/chat] message len=${body.message.length} topicId=${body.topicId ?? 'none'}`,
  );
  try {
    const reply = await getPhotoBrain().send(body.message, body.topicId);
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof InvalidMessageError) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
    if (err instanceof ChatBusyError) {
      return NextResponse.json({ error: 'busy' }, { status: 409 });
    }
    console.error('[api/photography/chat] agent error:', err);
    return NextResponse.json({ error: 'agent_error' }, { status: 502 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  getPhotoBrain().clear();
  return NextResponse.json({ ok: true });
}
```

> NOTE for implementer: match the app-internal import style — if other `app/` files import `app/lib` modules with a `.js` suffix, add it to the `photo-brain` import too (bundler resolution accepts both; consistency wins).

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: clean (both tsconfigs).

Run: `npx vitest run tests/domains/photography/`
Expected: all PASS.

Optional smoke (needs env vars in `.env`): `npm run dev`, then from another terminal:
`curl -su "$WEB_USER:$WEB_PASSWORD" localhost:3000/api/photography/chat` → `{"messages":[]}`.

- [ ] **Step 4: Commit**

```bash
git add app/lib/photo-brain.ts app/api/photography/chat/route.ts
git commit -m "feat(web): photo brain singleton + /api/photography/chat route"
```

---

### Task 7: Slide-over drawer UI + sidebar wiring

A `'use client'` component rendering a "Photo Brain" sub-nav button plus a portal-mounted right-side drawer. The portal is required: the sidebar `<aside>` uses CSS transforms, which would hijack `position: fixed` descendants.

**Files:**
- Create: `app/components/photo-brain-drawer.tsx`
- Modify: `app/components/sidebar.tsx` (render the nav item inside the photography sub-nav)

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/photography/chat` from Task 6; `Markdown` from `app/components/markdown.tsx`.
- Produces: `PhotoBrainNavItem({ onNavigate }: { onNavigate: () => void })` — sidebar consumes it.

- [ ] **Step 1: Create the drawer component**

Create `app/components/photo-brain-drawer.tsx`:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { Markdown } from './markdown';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

const SEND_TIMEOUT_MS = 90_000; // matches the Submit modal ceiling — tool loops are slow

function errorCopy(status: number | null, code: string | null): string {
  if (code === 'busy') return 'Photo brain is still answering — give it a second and resend.';
  if (code === 'invalid_message') return 'Message is empty or too long (4000 char max).';
  if (status === 401) return 'Session expired — reload the page.';
  if (status === null) return 'Timed out or lost connection — your message is back in the box, try again.';
  return 'Something went wrong — your message is back in the box, try again.';
}

/** Current topic page, if the user is on one (server re-validates regardless). */
function topicIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/photography\/([^/]+)$/);
  const seg = m?.[1];
  if (!seg || seg === 'assignments') return undefined;
  return decodeURIComponent(seg);
}

export function PhotoBrainNavItem({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); onNavigate(); }}
        className="block w-full rounded-chip px-2 py-1 text-left text-[12px] text-text-secondary hover:text-text-primary"
      >
        Photo Brain
      </button>
      {open && <PhotoBrainDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoBrainDrawer({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate from server history on open; focus the input.
  useEffect(() => {
    fetch('/api/photography/chat')
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((data: { messages: ChatMsg[] }) => setMessages(data.messages))
      .catch(() => { /* empty history is a fine fallback */ });
    inputRef.current?.focus();
  }, []);

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Keep the newest message in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || pending) return;
    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setPending(true);
    try {
      const r = await fetch('/api/photography/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, topicId: topicIdFromPath(pathname) }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw Object.assign(new Error('api'), { status: r.status, code: body.error ?? null });
      }
      const data = (await r.json()) as { reply: string };
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      // Roll back the optimistic user turn and put the text back for retry.
      setMessages((prev) => prev.slice(0, -1));
      setInput(message);
      const status = (e as { status?: number }).status ?? null;
      const code = (e as { code?: string }).code ?? null;
      setError(errorCopy(status, code));
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }, [input, pending, pathname]);

  async function newChat() {
    setError(null);
    try {
      await fetch('/api/photography/chat', { method: 'DELETE' });
      setMessages([]);
    } catch {
      setError('Could not clear the conversation — try again.');
    }
  }

  const drawer = (
    <div role="dialog" aria-modal="true" aria-label="Photo Brain" className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l border-border-subtle bg-bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border-divider px-4 py-3">
          <span className="text-[15px] font-bold tracking-[-0.01em] text-text-primary">Photo Brain</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={newChat}
              disabled={pending || messages.length === 0}
              className="rounded-input px-2 py-1 text-[12px] text-text-muted hover:text-text-primary disabled:opacity-40"
            >
              New chat
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-input px-2 py-1 text-[18px] leading-none text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>

        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {messages.length === 0 && !pending && (
            <p className="text-[13px] text-text-muted">
              Ask about your current assignment, technique, or shoot planning.
              Weather, sun times, and trails included.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="ml-8 rounded-card bg-chip-active px-3 py-2 text-[13px] text-text-primary">
                {m.content}
              </div>
            ) : (
              <div key={i} className="mr-4">
                <Markdown text={m.content} />
              </div>
            ),
          )}
          {pending && (
            <p className="animate-pulse text-[13px] text-text-muted">Thinking…</p>
          )}
        </div>

        {error && (
          <p className="border-t border-border-divider px-4 py-2 text-[12px] text-red-400">{error}</p>
        )}

        <div className="flex items-end gap-2 border-t border-border-divider px-4 py-3">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            maxLength={4000}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask the photo brain… (Enter to send)"
            className="flex-1 resize-none rounded-input border border-border-subtle bg-bg-surface-raised px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={pending || !input.trim()}
            className="rounded-input border border-border-subtle px-3 py-2 text-[13px] font-semibold text-text-primary disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(drawer, document.body);
}
```

> NOTE for implementer: class names use the design tokens already present in `sidebar.tsx` / `modal.tsx` (`bg-bg-surface`, `bg-bg-surface-raised`, `rounded-card`, `rounded-input`, `rounded-chip`, `bg-chip-active`, `border-border-subtle`, `border-border-divider`, `text-text-*`, `shadow-card`). If any of these is missing from the Tailwind config, substitute the nearest existing token — do not invent new tokens. For the error color, reuse whatever `topic-actions.tsx` uses for its error text if it differs from `text-red-400`.

- [ ] **Step 2: Wire into the sidebar**

In `app/components/sidebar.tsx`, add the import at the top:

```tsx
import { PhotoBrainNavItem } from './photo-brain-drawer';
```

In `DomainGroup`, extend the sub-nav block (currently `{isSectionActive && subNav && (...)}`) so photography also renders the chat button:

```tsx
      {isSectionActive && subNav && (
        <div className="ml-[18px] border-l border-border-divider pl-2">
          {subNav.map((item) => (
            <SubNavLink key={item.href} {...item} onClick={onClick} />
          ))}
          {slug === 'photography' && <PhotoBrainNavItem onNavigate={onClick} />}
        </div>
      )}
```

(`onNavigate={onClick}` closes the mobile sidebar drawer when the chat opens. Leave the global "Agent → Chat soon" placeholder untouched — that's the future cross-domain chat, not this feature.)

- [ ] **Step 3: Verify in the browser**

Run: `npm run typecheck` — expected clean.

Run: `npm run dev` and check manually:
- "Photo Brain" appears under Photography sub-nav only when in the photography section.
- Drawer opens over the page, Esc + overlay close it, input auto-focuses.
- Sending shows the optimistic user bubble + "Thinking…", then the reply renders as markdown.
- On a topic detail page, ask "what is this assignment about?" — reply should reference that topic (context injection working end-to-end).
- Reload the page, reopen drawer — history rehydrates from the server.
- New chat clears both server and UI.
- Force an error (stop the dev server mid-send): message returns to the input with friendly copy.

- [ ] **Step 4: Commit**

```bash
git add app/components/photo-brain-drawer.tsx app/components/sidebar.tsx
git commit -m "feat(web): photo brain slide-over drawer + sidebar entry"
```

---

### Task 8: Full verification + deploy checklist

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx vitest run`
Expected: entire suite PASS (bot/cron/outdoor tests confirm no regression from Tasks 1-4).

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 2: Manual acceptance (5-question drawer session, live agent)**

With real env vars in `.env`, `npm run dev`, then in the drawer:
1. From the Skills grid: "what should I work on next?" — expects curriculum-aware answer via `list_topics`.
2. From a topic detail page with an active assignment: "what is this assignment asking for, exactly?" — expects page-context + `get_active_assignment` grounding.
3. "Is tomorrow morning good light for it? Where should I shoot near Boulder?" — expects forecast + sun-times (+ trails) tool use, times in MT.
4. "Actually just skip this one for me." — expects redirection to the Skip button, NO claim of having skipped.
5. Send a photo critique request — expects redirection to the assignment submit flow.

Also verify the Telegram bot still chats normally (regression on shared agent): send the bot one `/photo` message.

- [ ] **Step 3: Deploy config**

Before deploying the Web service, confirm `PIRATE_WEATHER_API_KEY` is set on the **Web** Railway service (bot/cron already have it; web did not need it until now). Per the railway-cli skill: `railway variables --service <web service>` to check, `railway variables --set "PIRATE_WEATHER_API_KEY=..." --service <web service>` to add. Confirm the target service with Tom before the first deploy of the session.

- [ ] **Step 4: Docs (requires Tom's confirmation — do not edit unprompted)**

Propose to Tom: a DECISIONS.md entry (2026-07-20 — photo brain web chat: shared agent + surface param, in-memory conversation, converse-only, cost controls) and a CLAUDE.md update (web UI row + photography row mentioning the chat drawer and `/api/photography/chat`). Only write them after he confirms.
