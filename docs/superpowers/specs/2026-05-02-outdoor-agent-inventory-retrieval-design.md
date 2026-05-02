# Outdoor Agent — Inventory Retrieval Design

**Date:** 2026-05-02
**Status:** Approved (Tom 2026-05-02)
**Phase:** Phase 2 (Outdoor agent v1) — design only; implementation gated on Phase 1 soak completing 2026-05-08
**Author:** Brainstormed with Claude

---

## Problem

The outdoor agent (Phase 2) needs to answer four kinds of questions across Tom's full inventory:

| Pattern | Example | Cross-cutting? |
|---|---|---|
| A. Specific lookup | "What hardshells do I own?" | Single category |
| B. Activity prep | "What's my MTB kit?" | Crosses many categories along an activity axis |
| C. Aspect / condition | "What wet-weather gear do I have?" | Crosses categories along an attribute not in the schema |
| D. Open-ended advice | "What's missing from my MTB kit?" | Needs global inventory awareness |

The sheet's category schema is leaf-specific (`Camping Gear / Sleep System`, `Hiking Gear / Footwear`, etc.). It's good for human browsing and the future read-only web UI but is the wrong access shape for an agent that thinks in activities, conditions, and use cases.

## Goals

1. The Phase 2 agent answers all four query patterns equally well from day one.
2. The architecture stays simple at current scale (~400 rows) and degrades gracefully as inventory grows.
3. We instrument enough to know when to evolve the architecture, rather than guessing.
4. The retrieval design does not block the Phase 1 soak window (no parser or sheet-schema changes).

## Non-goals

- Adding `Activity` or `Tag` columns to the sheet at ingest time. Deferred until proven necessary.
- A vector / semantic-search retrieval layer.
- Cross-domain retrieval. Outdoor agent only sees Outdoor-domain rows.
- Editing the sheet via the agent (write actions like `/log`, `/retired` are separate slash commands; this spec covers read-side retrieval only).

## Decision summary

**Approach: full-context, with compact serialization, content-hash refresh, and instrumentation for a future hybrid flip.**

The agent's system prompt contains the entire active outdoor inventory in a compact format. Sonnet 4.6 reads, filters, and reasons in one shot. No retrieval tools in v1. We instrument the bot so we know when to migrate to hybrid (Tier 1 summary in prompt + `searchInventory()` tool for drilling in). Trigger checklist defined below.

---

## Architecture

### Components

```
apps/bot/
  index.ts              # Telegram listener (existing Phase 2 task)
  router.ts             # Domain dispatch (existing Phase 2 task)
  inventoryCache.ts     # NEW — in-memory snapshot, refresh loop, hash check
  stats.ts              # NEW — instrumentation logging + /stats command

domains/outdoor/
  agent.ts              # Existing Phase 2 task — system prompt builder + Claude call
  inventory.ts          # Existing Phase 2 task — query helpers (thin in v1)
  serialize.ts          # NEW — compact row formatter

lib/
  sheets.ts             # Existing — gains a getAllRows() helper if not already present
```

### Data flow (per query)

```
Telegram message
  → apps/bot/index.ts: receive
  → apps/bot/router.ts: dispatch to outdoor agent
  → domains/outdoor/agent.ts:
       - read inventoryCache.snapshot (in-memory)
       - serialize.compact(snapshot) — cached as long as snapshot hash unchanged
       - build system prompt: [agent persona] + [tool defs] + [compact inventory]
       - cache_control: ephemeral on the inventory block (Anthropic prompt caching)
       - send to Claude with conversation history
  → Claude responds
  → apps/bot/index.ts: relay to Telegram
  → stats.ts: log token count, cache hit/miss, first-token latency
```

### Data flow (refresh)

```
Bot startup
  → inventoryCache.refresh(): full sheet read → snapshot v1 + hash v1

Background timer (every 15 min)
  → inventoryCache.refresh()
       - sheet read
       - compute new hash
       - if hash unchanged → no-op (cached system prompt stays warm)
       - if hash changed → swap snapshot atomically; next query rebuilds system prompt (one cold-cache write)

Bot self-write (e.g., /log, /retired in Phase 2)
  → write to sheet → inventoryCache.applyLocalChange(row) → hash changes
  → next query is a cold-cache write (expected)
  → trust the local write; the next 15-min timer refresh reconciles if the sheet was edited concurrently elsewhere

Sheets API failure
  → retry with exponential backoff (3 attempts)
  → on persistent failure: keep serving from stale snapshot, log warning, fire Telegram alert (reuse Phase 1 alerting)

/refresh slash command (admin/Tom only)
  → forces immediate inventoryCache.refresh()
```

### Compact serialization

**Goals:** preserve all retrieval-relevant fields, drop fields the agent doesn't need to reason, target ~25-35 tokens per row.

**Drop from agent context:**
- `Order ID` (column L) — opaque identifier, no agent value
- `Reasoning` (column Q) — was useful at classification time, redundant at query time
- `Product URL` (column P) — fetched on demand via a separate `getProductURL(itemId)` tool when the agent wants to recommend a link
- `Date Purchased` (column B) — drop full date; keep `Year` (column A) only

**Compress:**
- `Status` (column M) → single letter: `a`=active, `r`=retired, `x`=returned, `l`=lost, `b`=broken, `s`=sold, `d`=donated, `e`=excluded
- `Color` and `Size` → omitted with their wrapping parens when both blank; if only one is present, render `(<value>)` with no comma
- `Sub-Category` → joined with Category as `Category/Sub-Category` (or just `Category` if Sub-Category blank)
- `Brand` blank → render the item name with no leading space; do not emit a placeholder

**Format (one row per line):**

Pseudo-grammar (`{}` denotes a literal optional segment, not part of the output):

```
<Year> | {<Brand> }<Item Name>{ (<Color>{, <Size>})} | <status-letter> $<Price> [<Category>{/<Sub-Category>}]
```

**Example rows:**

```
2026 | Therm-a-Rest Z Lite Sol Sleeping Pad (Limon, Reg) | a $49.95 [Camping Gear/Sleep System]
2026 | Salomon X Ultra 5 Mid GORE-TEX Hiking Boots (Black/Asphalt/Castlerock, 9) | a $190 [Hiking Gear/Footwear]
2026 | 12 Pack Tent Stake with Hammer | a $19.99 [Camping Gear/Camp Accessories]
```

**Inventory header (sent once at top of compact block):**

```
=== INVENTORY (every non-excluded row; status code shows lifecycle state) ===
Format: Year | [Brand] Item (Color, Size) | status $price [Category/Sub-Category]
Status codes: a=active, r=retired, x=returned, l=lost, b=broken, s=sold, d=donated
Total rows: <N>
```

**Filtering:** include only rows where `Domain=Outdoor`. Other domains (Photography, Media, etc.) are filtered out for the outdoor agent.

**Ordering:** by `Category`, then `Year` desc, then `Item Name`. Stable order keeps the cache hash stable across no-op refreshes.

### Caching layers

1. **In-process snapshot** (Node memory) — refreshed by 15-min timer. Held as parsed `Item[]` array.
2. **Compact-string memoization** — the serialized string is rebuilt only when snapshot hash changes. Saves CPU on every query.
3. **Anthropic prompt cache** — system prompt has `cache_control: { type: 'ephemeral' }` on the compact-inventory block. Default 5-min TTL initially; consider 1-hour beta TTL if cold-write frequency justifies the 2x write cost.
4. **Conversation history** — bot keeps a single long-running Claude conversation per session. Cache stays warm across consecutive Telegram messages.

### Cost / latency profile (current scale, 400 rows compact)

| Scenario | Tokens | Cost | Latency |
|---|---|---|---|
| Cold-cache write (5-min TTL) | ~12K | ~$0.045 | ~3-5s first token |
| Warm-cache read | ~12K | ~$0.004 | ~1-2s first token |
| Per-query message tokens | ~50-200 | negligible | — |

**Estimated monthly cost** at ~10 queries/day across ~3 sessions/day: **~$5/month.**

### Instrumentation

`apps/bot/stats.ts` logs (Railway logs + in-memory counters for `/stats`):

- Per query:
  - `system_prompt_tokens`
  - `cache_hit` (boolean from Anthropic response usage block)
  - `first_token_ms`
  - `total_response_ms`
- Per refresh:
  - `inventory_row_count`
  - `refresh_duration_ms`
  - `hash_changed` (boolean)
- Per session (rolling 7-day):
  - `cold_writes_per_day`
  - `warm_reads_per_day`
  - `estimated_monthly_cost_usd`

**`/stats` command output (Tom-only):**

```
Inventory: 412 rows (Outdoor: 287)
System prompt: 9.2K tokens
Last refresh: 4 min ago (no change)
Last 7d: 28 cold writes, 142 warm reads
Est monthly cost: $4.80
Threshold status: 0/4 hit
```

### Soft threshold — when to flip to hybrid mode

Trigger checklist; **flip when ≥ 2 of 4 hit:**

| Signal | Threshold |
|---|---|
| Active outdoor inventory size | ≥ 2,000 rows |
| Monthly cold-cache write cost (rolling 30-day) | > $30 |
| First-query latency, cold (p50) | > 8 seconds |
| Free conversation context budget | < 40K tokens |

**Hybrid mode (deferred design — built when triggered, not now):**

- Tier 1 (cached system prompt): agent persona + tool definitions + **inventory summary** (counts by category/sub-category, brand list, recent 30-day additions in full, status distribution). Target ~5-10K tokens regardless of inventory size.
- Tier 2 (on-demand tool): `searchInventory({ category?, subCategory?, brand?, status?, text?, dateRange?, priceRange?, limit? })` returns matching rows in compact format.
- Agent prompt updates: instructions on when to call `searchInventory` vs answer from summary.

The compact serialization built in v1 is reused for Tier 2 tool responses, so the migration is mostly additive.

---

## Open questions / accepted risks

1. **Cache TTL choice.** Start with default 5-min ephemeral cache. Revisit at first monthly cost check; switch to 1-hour beta TTL if cold writes dominate cost.
2. **Conversation lifetime.** Bot maintains one Claude conversation per Telegram session (defined as: messages within 1 hour of each other). After 1 hour idle, start a new conversation. This bounds conversation history growth.
3. **Status filter default.** Compact output includes ALL non-`excluded` items, with status letter visible. Agent reasons about `retired`/`returned`/etc. itself. If this proves noisy, add a `Hide retired by default` flag with an agent override tool.
4. **Multi-domain agent later.** When other domains (Kitchen, Photography) get agents, each builds its own compact view from its domain-filtered subset. The serialize/cache pattern is reusable; no shared cache across agents.

## Acceptance criteria

The retrieval layer is "done" for Phase 2 when:

1. Bot starts, fetches sheet, builds compact serialization in < 2s for current size.
2. `/stats` returns sensible numbers and threshold status.
3. The agent answers one example of each pattern (A, B, C, D) with full visibility into the inventory:
   - A: "What hardshells do I own?"
   - B: "What's in my MTB kit?"
   - C: "What wet-weather gear do I have?"
   - D: "What's missing from my backpacking setup?"
4. Refresh timer fires, hash check correctly identifies no-op vs. real change, no-op refreshes do not invalidate the prompt cache.
5. `/refresh` command forces immediate refetch.
6. Sheets API outage → bot serves from stale snapshot + logs warning.
7. Cold-cache and warm-cache costs match estimates within 2x.

## Out of scope (this spec)

- The agent's system prompt content (tone, capabilities, refusal patterns) — that's a separate Phase 2 design decision.
- Slash commands (`/log`, `/retired`, etc.) — separate Phase 2 task.
- Tool schemas for non-inventory tools (web_search in 2.5, weather in 3, AllTrails in 4, etc.).
- The Phase 6 web UI's filtering implementation (different consumer, different requirements).

## Implementation notes

- Add `apps/bot/inventoryCache.ts`, `apps/bot/stats.ts`, `domains/outdoor/serialize.ts` as new files.
- Existing `lib/sheets.ts` already has the column-order-agnostic header map (per Phase 1 commit `ccef3be`); reuse it.
- Hash function: `crypto.createHash('sha256')` over the sorted serialized rows. Cheap and stable.
- All new code under TypeScript strict mode (per project conventions).
- Tests: vitest unit tests for `serialize.ts` (golden-file fixtures) and `inventoryCache.ts` (hash stability, no-op refresh, refresh on change).

## Dependencies

- **Hard:** Phase 1 soak completes cleanly (target 2026-05-08). No code in this spec ships before then.
- **Soft:** Tom is comfortable with the 1-hour conversation lifetime heuristic (open question 2). Easy to tune later.

---

## Revision log

- 2026-05-02 — Initial design, brainstormed with Claude, approved by Tom.
