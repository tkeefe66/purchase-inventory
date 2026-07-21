# Photo Brain Web Chat — Design

**Date:** 2026-07-20
**Status:** Approved for planning

## Summary

Add a conversational surface for the existing photography agent ("photo brain") to the Next.js web app, so Tom can ask questions about assignments, theory, and technique without leaving the page he's working on. One shared `PhotographyAgent` serves both Telegram and web; the web gets a slide-over drawer available anywhere in the photography section, aware of the topic page currently being viewed.

Includes two cost-control fixes to the shared agent loop (history trim + message-level prompt caching) that benefit both surfaces.

## Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Surface | Web app chat; Telegram untouched (no shared memory between surfaces) |
| Scope | One global conversation across the photography section, context-aware of the topic page being viewed |
| Persistence | Server in-memory `ConversationStore` (30-min idle TTL, keyed `'web'`); restart/deploy starts a fresh chat — same behavior as Telegram |
| Delivery | Single-shot POST + typing indicator; no streaming |
| UI shape | Right-side slide-over drawer. Originally opened from a "Photo Brain" button in the photography sub-nav; **revised same day post-ship to a floating bottom-right chat button** (`PhotoBrainFab`), visible only in the photography section |
| Agent powers | Converse only. Reads everything (tools below); mutations stay in the existing Learn/Start/Skip/Submit modals — agent directs users to the buttons |
| Architecture | Approach 1: shared `PhotographyAgent`, parameterized by surface (`'telegram' | 'web'`) — no fork, no generic agent-core extraction (deferred, YAGNI) |
| Model | Opus 4.7 primary with existing Sonnet/Haiku 529 fallback — same brain as Telegram; not downgrading web chat to Sonnet (quality is the product; volume is one user; caching fixes remove most waste) |

## Architecture & data flow

```
PhotoBrainDrawer (client) ── POST /api/photography/chat {message, topicId?}
                                  │
                                  ▼
             app/lib/photo-brain.ts (globalThis singleton:
               Anthropic client + ConversationStore + PhotographyAgent + web tool deps)
                                  │
                                  ▼
             PhotographyAgent.handleMessage('web', text, {viewingTopic})
               ├─ system prompt: shared persona/guardrails/tool-guidance
               │    + cached inventory/progress block (unchanged)
               │    + surface block ('web' variant)
               │    + per-turn page-context block (uncached, appended last)
               ├─ existing tool loop (max 8), model fallback, retry
               └─ ConversationStore 'web' key, 30-min idle TTL
```

Architectural rules respected: `domains/photography/` imports only from `lib/`; `app/` (the web app) wires `domains/` + `lib/` together, mirroring how `apps/bot` does.

## Components

### 1. Agent changes — `domains/photography/agent.ts`

**Surface parameterization.** `buildSystemPrompt` gains `surface: 'telegram' | 'web'`.

- `'telegram'`: current formatting/slash-command text, verbatim — zero behavioral change for the bot.
- `'web'`: standard markdown formatting guidance; "the app has Learn / Start / Skip / Submit buttons on topic pages — direct the user there for actions" (enforces converse-only); no slash-command references.

**Page context.** `handleMessage(chatId, text, opts?)` accepts `opts.viewingTopic?: { id, name }`. When present, an **uncached** system block is appended after the cached block: "The user is currently viewing the topic page for <name>." System-level and per-turn, so it is never persisted into history and stale page context cannot pollute the conversation. Appending after the cache breakpoint preserves the cached prefix.

**Cost controls (shared with Telegram):**

- **History trim:** when building the request, use only the last 30 messages from `ConversationStore`. Store keeps everything within TTL; the trim happens at request-build time.
- **Message cache breakpoint:** `cache_control: { type: 'ephemeral' }` on the last message block of each API call, so tool-loop iterations 2..N read the prior prefix (system + history + earlier tool turns) at 0.1× input price instead of full $15/MTok. Anthropic ratios already documented in `lib/models.ts`.
- **System breakpoint placement:** the system cache breakpoint moves from the inventory block (block 2 of 5) to the last static block (block 5), so all five system blocks ride the cache instead of two — the three static guidance blocks were previously re-billed at full input price on every call. The per-turn page-context block is appended after the breakpoint, so it never invalidates the cached prefix.

Tool registry, model fallback chain, retry logic, `MAX_TOKENS = 1024`, `MAX_TOOL_LOOPS = 8`: unchanged.

### 2. Web deps adapter — `app/lib/photo-brain.ts`

Module-level singleton via the `globalThis` pattern (survives Next dev hot-reload without duplicating). Holds:

- `Anthropic` client (`ANTHROPIC_API_KEY`)
- `ConversationStore` (`idleTtlMs: 30 * 60 * 1000`)
- Sheets client via `createSheetsClient`
- `PhotographyAgent` constructed with `surface: 'web'` and web-side tool deps

Tool deps reuse the existing 30s-cached readers in `app/lib/photography-data.ts` where they fit (progress, assignments, inventory snapshot); anything missing gets a small cached reader in the same file, mirroring `apps/bot/photographyCache.ts` semantics (short TTL, invalidate on write — though web chat performs no writes).

### 3. API — `app/api/photography/chat/route.ts`

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, same conventions as the four existing photography routes. Auth via existing HTTP Basic Auth `middleware.ts` — no new auth.

| Method | Behavior |
|---|---|
| `GET` | Returns `{ messages: [{role, content}] }` — current history (store holds only final text turns, no tool noise). Drawer hydrates from this on open. |
| `POST` | Body `{ message: string, topicId?: string }`. Validates: non-empty after trim, ≤ 4000 chars (`400 { error: 'invalid_message' }`). `topicId` validated against the skill tree (`domains/photography/skillTree.ts`); unknown IDs (e.g. the literal path segment `assignments`) are **silently omitted**, never an error. In-flight guard: one turn at a time — concurrent POST returns `409 { error: 'busy' }`. Calls `handleMessage('web', message, { viewingTopic })`; returns `{ reply }`. |
| `DELETE` | Clears the `'web'` conversation. Returns `{ ok: true }`. |

Logging: request received (message length, topicId), model used + tool calls made per turn, errors with cause. Same style as existing routes.

### 4. UI

**`PhotoBrainButton` + `PhotoBrainDrawer`** — one client component pair mounted in the photography section (sub-nav already renders only inside `/photography/*`, so placement is free; button and drawer live in one client component so no cross-component state plumbing is needed). *(Post-ship revision, same day: the launcher is now `PhotoBrainFab`, a floating bottom-right chat button mounted in the root layout, shown only in the photography section. Drawer unchanged.)*

Drawer (right-side slide-over, page behind stays visible and dimmed):

- Message list: user turns plain; agent turns rendered through the existing `marked`-based markdown component (`app/components/markdown.tsx`)
- Input + send; input disabled while a turn is in flight; typing indicator during POST
- `AbortSignal.timeout(90_000)` — matches the Submit modal's ceiling (agent turns with tool loops can be slow)
- "New chat" button → `DELETE` then clears local list
- Overlay click / Esc closes; `role="dialog"`, focus moves into drawer on open
- Current topic detection from pathname: `/photography/<segment>` where segment is not `assignments` → sent as `topicId` (server re-validates regardless)
- Error handling follows `topic-actions.tsx` patterns: `ApiError` / `describeError`-style mapping of `{error: code}` to friendly copy; on failure the failed message returns to the input for retry

Open/closed state is local (`useState`); history lives server-side and is fetched on each open.

## Error handling

- Model overload: existing Opus → Sonnet → Haiku 529 fallback + `callWithRetry` backoff, unchanged.
- Route errors → `{ error: code }` JSON (`invalid_message`, `busy`, `agent_error`) with friendly drawer copy.
- Client timeout aborts cleanly; in-flight guard prevents double-sends; failed sends are retryable without retyping.
- Agent throw after retries → `502 { error: 'agent_error' }`, logged with cause.

## Testing

Vitest, TDD-first:

- `buildSystemPrompt` surface swap: `'telegram'` output byte-identical to current (regression); `'web'` asserts button guidance present, slash-command text absent.
- `handleMessage` page-context injection with mocked Anthropic: block present when `viewingTopic` passed, absent otherwise, never persisted to history.
- History trim: >30 stored messages → request contains exactly last 30.
- Cache breakpoint: last message block of each constructed request carries `cache_control`.
- Route logic: empty/oversize message → 400; concurrent POST → 409; unknown `topicId` → context omitted, no error; DELETE clears.
- Existing photography agent tests stay green (Telegram regression gate).

Manual acceptance: 5-question drawer session against the live agent — context awareness ("what's this assignment asking for?" from a topic page), tool use (weather/sun-times question), action redirection ("skip this one" → pointed at the Skip button), history survives page reload, New chat resets.

## Out of scope

- Streaming (SSE) — revisit if single-shot waits annoy
- Shared memory between Telegram and web conversations
- Chat-initiated mutations (start/skip via chat)
- Generic agent-core extraction to `lib/` (outdoor + photography loop dedup) — noted as future cleanup
- Durable conversation persistence (volume/sheet)

## Cost profile (with the two cost controls)

Opus 4.7: $15/MTok input, cache read $1.50/MTok, output $75/MTok capped at 1024 tokens/turn. Typical turn $0.03–0.10; heavy tool-use turn ~$0.25; expected single-user monthly cost: low single-digit dollars. Without the controls, long sessions with tool loops could plausibly reach $1+/turn — which is why the trim + message breakpoint ship as part of this feature rather than later.
