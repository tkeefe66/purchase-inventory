# DECISIONS.md — Inventory Platform

> Append-only log of design and product decisions. When a future Claude session questions "why did we do X?" — read this. Do not overwrite history; if a decision changes, add a new dated entry referencing the prior one.

---

## 2026-04-30 → 2026-05-01 — Initial planning session

### The big reframe

**Original spec (in source product doc):** "Outdoor inventory app" — a single-purpose Node.js + Railway service that parses REI + Amazon emails into a Google Sheet.

**Reframed during this session:** A **purchase-ingest + categorization platform** that powers domain-specialist AI agents. Outdoor is the first domain; Kitchen, Photography, etc. follow on the same architecture.

**Why:** Tom asked "could this be bigger?" The platform framing is a better product because:
- The ingest pipeline is reusable infrastructure for every future domain
- Domain-bounded specialist agents beat one giant generalist (smaller context, focused tool sets, domain-specific external integrations)
- Adding a new domain becomes a 1-2 week effort, not a rebuild
- Personal-context-x-domain-expertise is the unique value vs. generic chatbots

**Discipline rule established:** *Architect for the platform; ship one domain at a time.* Outdoor must be at Phase 6 (or Phase 5) in `PLAN.md` before any second-domain work begins. This is to prevent the "great architecture, nothing shipped" failure mode.

---

### Q&A — locked decisions

The following 28+ questions were resolved during this session. Format: question (paraphrased) → answer + rationale.

#### Backfill & historical data

**1. First-run scope.** Tom will provide a CSV of historical REI + Amazon purchases. The cron will only process *future* emails. Backfill is a one-time `scripts/import-history.ts` invocation, not an email re-parse. *Why: avoids the blast-radius problem of double-adding historical purchases that are still sitting in the inbox.*

**2. Dedup approach.** Within the cron, dedup by `(Order ID, Item Name, Color, Size)`. Tom asked "isn't searching for product enough?" — answer: not quite, because legitimately re-buying the same item next year would otherwise be blocked. Order ID makes "I bought the same thing in a separate order" a non-collision.

**3. Categories.** Use existing sheet category vocabulary; classifier is allowed to create new categories when nothing fits. Existing data is preserved.

#### Email matching

**4. REI sender.** `rei@notices.rei.com`.

**5/6. Amazon senders.** Use BOTH `auto-confirm@amazon.com` (order confirmation, primary source for price/total) AND `ship-confirm@amazon.com` (shipment confirmation, primary source for line items — more stable format). *Why: order confirmation has the price truth; shipment confirmation has the cleaner item list.*

> ⚠️ **Updated May 2026:** verified against Tom's Gmail — `ship-confirm@amazon.com` returns 0 hits over 2 years. The actual sender is `shipment-tracking@amazon.com` (subject prefix "Shipped: …"). PLAN.md and the gmail.ts query updated accordingly. **Order-confirmation primacy assumption was wrong.** Per the next entry below ("Amazon parser sources shipment-tracking only"), the order-confirmation email shows only the order *total* (not per-item prices). Shipment-tracking is now the canonical source. **Additional quirk that still applies:** Amazon emails sometimes bundle multiple orders (different Order IDs) under one subject ("Ordered: 'X' and 1 more item"); parser walks per-Order-ID section.

---

## 2026-05-01 — Amazon parser sources shipment-tracking only

> ⚠️ **Superseded 2026-05-15** — see "Amazon parser also ingests `auto-confirm` order emails (via Haiku)" below. Order emails are now parsed; the original concern about no per-item prices turned out to be incorrect for modern Amazon order emails, which do carry per-line-item prices.

**Context:** Phase 1 TDD on the Amazon parser revealed that order-confirmation emails (`auto-confirm@amazon.com`, "Ordered: …") only carry the **order total**, not per-item prices. The order total includes shipping/tax/discounts, so it can't be split per item. Per-item pricing lives in shipment-tracking emails (`shipment-tracking@amazon.com`, "Shipped: …") instead, in a typographic `<sup>$</sup><span>1,498</span><sup>00</sup>` pattern that styles the dollar sign and cents as superscripts.

**Decision:** **The Amazon parser parses shipment-tracking emails only.** Order-confirmation emails return `null` (the cron fetches them, sees null, applies the processed label, moves on without ingesting).

**Why:**
- Shipment-tracking has everything we need: Order ID, item name (from `<img alt>`), Quantity, per-item price.
- Order-confirmation only has Order ID + item names + order total. Without per-item prices, we'd insert placeholder rows with `price=0`, then have to merge updates from later shipment emails — significant added complexity for marginal benefit.
- The 1–3 day lag between order placement and shipment notification is acceptable. The cron runs twice daily, so worst case a shipped item appears in the sheet within ~12 hours of shipping. Tom doesn't need real-time order tracking — he wants accurate inventory.
- `Status` semantics stay clean: every row in the sheet has a real price and represents an item that physically shipped.

**Trade-offs accepted:**
- Cancelled / returned orders that never shipped will not appear in the sheet at all (good — saves a noise row).
- Orders that ship in multiple shipments will produce one row per shipment for the same Order ID (acceptable — dedup key `(Order ID, Item Name, Color, Size)` still prevents true duplicates if a single item ships twice somehow).
- An item that's been ordered but not yet shipped is invisible to the agent for ~1–3 days. Marginal impact.

**How to apply:**
- `lib/parsers/amazon.ts`: `parseAmazonEmail(html)` returns `null` for any email that isn't a shipment-tracking email (heuristic: presence of "Quantity: N" line items + the `<sup>$</sup>` price structure). For shipment-tracking emails, returns `ParsedOrder[]` (one per Order ID — multi-shipment quirk still applies).
- `lib/gmail.ts` query: still fetches both senders. Order-confirmation emails just get labeled-and-skipped at the parser stage.
- `apps/cron/pipeline.ts` (Phase 1, Task 1.7): when parser returns null, apply the `inventory-processed` label and move on (no Needs Review entry — null is normal for non-receipt emails).
- PLAN.md Task 1.3 updated to reflect this.

**Future consideration:** if Tom decides he wants the "ordered but not yet shipped" visibility, we'd add Option B (parse both, merge) as a Phase 2+ enhancement. For v1, simpler wins.

---

## 2026-05-01 — Dedup key adds Brand + tolerant cross-match for historical rows

**Context:** First live cron run added 2 new REI rows that were actually duplicates of items already in the sheet from the historical migration. Two reasons:

1. **Brand split.** Historical (manually-entered) REI rows store `Brand="Salomon"` separately from `Item Name="X Ultra 5 Mid GORE-TEX Hiking Boots - Men's"`. Email parsers extract item names from `<img alt>` which includes the brand inline ("Salomon X Ultra 5 …"). Same item, two different itemName strings, original dedup key `(orderId, itemName, color, size)` failed.

2. **Color/size formatting drift.** Historical row had `Color="Black/Asphalt/Castlerock"` (full REI catalog colorway), email parse had `Color="Black/Asphalt"` (shorter form in the order email). Even with brand fixed, the color difference defeated dedup.

3. **Blank vs real Order IDs.** Historical REI rows have blank Order IDs (REI's source tab didn't carry them). Fresh emails have real Order IDs. Mixed.

**Decision (supersedes Decision #15 in the original Q&A log):** Two-level dedup matching.

```
DedupIndex = {
  fullKeys: Set<(orderId, brand, normalized-name, color, size)>,
  blankOrderContentKeys: Set<(brand, normalized-name)>     // built only from rows with blank Order ID
}

isDuplicate(newItem, index) =
  index.fullKeys.has(newItem.fullKey)                      ||  // exact match
  (newItem.orderId !== '' && index.blankOrderContentKeys.has(newItem.contentKey))   // cross-match
```

- **`makeDedupKey` (full):** `(orderId, brand, normalized-name, color, size)`. Used for exact matches — including same-Order-ID-different-color (legitimately bought 2 colors of one item in one order remain distinct rows).
- **`makeContentKey`:** `(brand, normalized-name)` — IGNORES color and size. Used for tolerant cross-matching against historical (blank-Order-ID) rows where the color/size formatting often differs between manual entry and email-parsed data.
- **`normalizeItemName`:** lowercases, strips brand prefix if present, collapses whitespace. Handles the inline-vs-split brand case ("Salomon X Ultra…" ↔ "X Ultra…").
- **Re-buy preserved.** Two real Order IDs + same brand+name = different rows allowed. Cross-match only fires when one side has blank Order ID — i.e. the existing row is a historical/manual entry, not a prior email-derived purchase.

**Why these specific trade-offs:**

- **Color/size in cross-match would be wrong.** Tom's manual entries use the full REI catalog colorway; emails use a shorter form. Requiring exact match on those means duplicates leak. Dropping them from cross-match catches the common case at the cost of a rare edge case (re-buying same item in different size against a historical no-Order-ID record).
- **Same-order color/size still distinct.** Within one Order ID, different colors must be different rows (you genuinely bought both). The full key keeps them separate.
- **Re-buys still tracked.** A new Order ID buying an item already in the sheet (with its own real Order ID) still creates a new row — that's a real purchase event we want recorded.

**How to apply:**

- `lib/dedup.ts`: `DedupKeyInput` adds `brand`. New helpers: `makeContentKey`, `buildExistingKeySet → DedupIndex`. `dedupItems(newItems, index)` does both checks.
- `lib/sheets.ts`: `readDedupKeys` returns `DedupIndex` (was `Set<string>`). All callers updated.
- `apps/cron/pipeline.ts`: dedup call passes brand into the key inputs.
- `scripts/dedup-existing.ts`: new one-off cleanup script. Groups existing rows by content key (brand + normalized name); removes within-Order-ID exact dupes and historical-vs-fresh-email cross-match dupes. **Run once with `--apply`** to clean up rows added before this fix; idempotent thereafter (re-runs find zero dupes).
- New tests in `tests/dedup.test.ts` lock the behavior — including the canonical "Salomon case" (different colorway formatting + brand prefix variation → still cross-matched).

**One-time cleanup applied during this work:** removed 3 rows from `All Purchases` — 1 within-order duplicate (CAP Barbell dumbbells inside Order 113-9160613-7873014) and 2 cross-match duplicates from the first live cron run (REI Co-op Base Camp 4 Tent and Salomon X Ultra 5 boots).

---

## 2026-05-01 — Sheets layer is column-order-agnostic (read/write by header name)

**Context:** During Phase 1 buildout we hit a real bug — Tom had reordered columns in the Sheets UI after the initial migration (he moved `Type` left to be next to other dropdowns, swapping the original `O=Product URL, P=Type` to the now-actual `O=Type, P=Product URL`). All my read/write code used hardcoded column indices (`row[14]` for Product URL), so reads returned the wrong field, the bootstrap script applied the Type validation dropdown to the wrong column, and the URL backfill wrote URLs to the Type column. None of this surfaced until I built `lib/sheets.ts` and ran a smoke test.

**Decision:** **All sheet I/O resolves columns by HEADER NAME, never by position.** `lib/sheets.ts` exports two helpers:

- `buildHeaderMap(headerRow): Map<string, number>` — reads the live header row and returns a name→index lookup.
- `colLetter(index): string` — converts a 0-indexed column to its A1 letter (handles A–Z, AA, AB, …).

Every read in `lib/sheets.ts` (readMasterRows, readDedupKeys, buildVocab) calls `readHeaderRow` first, builds a map, and accesses cells via `getCell(row, map, "Product URL")`. Every write (`appendRows`) does the same — it reads the live header order and arranges row values to match. `scripts/bootstrap-sheet.ts` looks up Status/Domain/Type by name when applying validation dropdowns, and the conditional-formatting formula `=$<col>2<>"active"` references the Status column letter dynamically. `scripts/backfill-urls.ts` looks up Product URL by name.

**Why:**

- The user-facing layout is what matters. Tom can drag columns around in Sheets to suit his review workflow — the code adapts.
- **Insurance against a real risk we already hit.** Position-based access broke silently the first time the layout drifted; header-based access fails loudly (a missing column throws a clear error) or works correctly under any reordering.
- Renaming a column is the only thing that still requires a code change (the name is the contract). That's a deliberate, infrequent action — and the failure mode is loud.

**Trade-offs accepted:**

- One extra Sheets API call per read/write to fetch the header row. Negligible (single round trip, ~50ms).
- Slightly more code in writers (build values array per the live order rather than as a fixed list).

**Lessons captured for future surface design:**

- Whenever code talks to a structure the user can rearrange (sheets, JSON columns, API responses with key order significance), prefer name-based access from the start. Adding it later requires migrating all the call sites.
- A "smoke test against real state" right after building any I/O layer would have caught this faster — defaulted to running it as part of every read/write feature now.

**How to apply (deltas):**

- `lib/sheets.ts`: rewrite all I/O via `buildHeaderMap` + `getCell` + `colLetter`. Throw with `requireColumns(map, names, tabName)` if any expected name is missing.
- `scripts/bootstrap-sheet.ts`: same pattern. Append missing headers at the end of the existing row (not at fixed positions). Apply validation dropdowns and conditional formatting based on header lookup.
- `scripts/backfill-urls.ts`: same pattern.
- `scripts/migrate-to-master.ts`: still has hardcoded header order in its `writeMasterRows` for *initial* tab creation, but the gating ("abort if All Purchases already has data") prevents it from accidentally overwriting a reordered tab. Will refactor when needed.
- `tests/sheets.test.ts`: unit tests for `buildHeaderMap` (including reordered cases) and `colLetter` (including multi-letter A–ZZ).
- `PLAN.md` schema row: adds a note clarifying the letters are *current* physical order, not authoritative — the names are.

**One-time fix applied during this work:** the misplaced Type-dropdown that the previous bootstrap-sheet had installed on column P was cleared via a one-off `setDataValidation` call with no `rule` field.

---

**7. Non-receipt emails.** No hardcoded ignore-list. If the parser determines an email isn't a receipt, skip silently. Don't apply the label so we can revisit later if needed.

#### Parser strategy

**8. Amazon parser.** Tier 1 regex/cheerio → Tier 2 Claude Haiku 4.5 fallback when regex fails or returns low confidence → Tier 3 Needs Review tab if Claude is also low-confidence. *Why: regex is free and works for the happy path; Claude handles the long tail of template variations; Needs Review prevents silent data loss.*

**9. REI parser.** Pure cheerio, no LLM. *Why: REI templates are stable enough; LLM cost not justified.*

**10. Needs Review tab.** Yes — separate tab in the same sheet for low-confidence / failed parses. Manual review workflow.

#### Data shape & accuracy

**11. Price.** Line-item price only. No shipping or tax allocation. *Why: matches what's already in the sheet.*

**12. Discounts.** Post-discount price (what the card was actually charged).

**13. Item lifecycle.** A new column `Status` (col M) tracks item state: `active` (default), `returned`, `lost`, `broken`, `sold`, `donated`, `excluded`. Tom had been using a separate "excluded" column on REI rows; this consolidates. *Why: one source of truth; the agent can filter by `status=active` when answering "what do I own."*

**14. Year column.** Derived from `Date Purchased` in **Mountain time** (`America/Denver`).

**15. Dedup key.** `(Order ID, Item Name, Color, Size)` — not just `(Order ID, Item Name)`. *Why: legitimately ordering two colors of the same item in one order shouldn't collide.*

**16. Brand allowlist.** Yes, seed from existing sheet's Brand column. Use as primary signal, fall back to LLM extraction.

**17. Color/Size for Amazon.** Often blank. Only fill when parser is confident. *Why: Amazon item titles rarely follow a parseable pattern; better blank than wrong.*

#### Operations

**18. Dry-run mode.** Yes — `--dry-run` flag prints proposed actions without writing.

**19. Reprocess command.** Yes — `--reprocess --since=<date>` bypasses the label filter.

**20. Notifications + conversational interface.** Telegram for both: failure alerts, daily digest, AND conversational interface to the inventory ("I want to talk to the agent about my gear and use my inventory as knowledge"). *This is the trigger for the entire Phase 2+ agent work.*

**21. OAuth consent screen.** Must be **published** (not Testing). *Why: refresh tokens for unpublished apps expire after 7 days, killing the cron silently.* Tom will need help with this when we get there.

**22. Cron schedule.** 6am AND 6pm Mountain time. Twice daily.

**23. Future retailer extensibility.** Yes — parser interface designed so adding Patagonia / Backcountry / MEC etc. is a 1-file addition.

#### Vision

**24. Day-to-day usage / PM framing.** Tom wants: "store what I buy, track spending, and have an agent I can talk to when I want to buy something — it knows what I own which is way easier than telling a general LLM." → *This is the moat. The agent without inventory grounding is just ChatGPT. The inventory without an agent is just a spreadsheet.*

**25. Web UI.** In for v1. Scoped down to **read-only dashboard** (filter by category/brand/year/status, spending chart). Editing deferred. *Why: editable UI requires conflict handling with the cron; not v1 scope.*

**26. Test fixtures.** Tom will forward 5–10 representative emails (REI single, REI multi, Amazon order, Amazon shipment, Amazon multi-shipment) which we save as `.html` files in `tests/fixtures/`. Tests run against those files for parser regression detection.

**27. CI.** Build directly in working directory, no worktree. *Why: greenfield project, no isolation benefit.*

**28. Bigger / smaller framing.** Recognized that the original spec was a monolith disguised as modular code. Reframed to a domain-extensible platform. Outdoor only in v1.

---

### Architecture decisions following the reframe

**A1. Project structure: `lib/` + `domains/<name>/` + `apps/`.**
- `lib/` is pure infrastructure (Sheets, Gmail, parsers, Claude wrapper, dedup, router scaffold). Knows nothing about specific domains.
- `domains/<name>/` is a self-contained module: classifier, inventory queries, agent prompt + tools, integrations.
- `apps/` (cron, bot, web) wires `lib/` and `domains/` together.
- Architectural rule: `domains/foo/` cannot import from `domains/bar/`.

*Why:* Adding a new domain is a folder-add operation. No churn in existing code.

**A2. Sheet schema: add `Domain` column N.**
- Master tab `All Purchases` with one `Domain` column rather than per-domain tabs
- Allowed Domain values in v1: `Outdoor`, `Other`. Future: `Kitchen`, `Photography`, `Home`, `Tech`, `Wardrobe`, `Auto`.
- Categorizer is two-stage: domain routing (which folder owns this item?) → in-domain category (what kind of thing is it within that domain?).

*Why:* Single source of truth, easy to reclassify later, simpler queries.

**A3. Agent model selection.**
- **Claude Haiku 4.5** for the Amazon parser fallback (cost-sensitive, structured-output task)
- **Claude Sonnet 4.6** for the outdoor agent (reasoning over inventory + weather + trail data)
- Prompt caching always on per global CLAUDE.md guidance

**A4. AllTrails MCP availability.**
- Tom has AllTrails connected to his Claude.ai account (newly added)
- The Telegram bot runs on Railway, not in Tom's Claude.ai session — so the AllTrails MCP may not be reachable from the deployed agent
- **Decision deferred to start of Phase 4**: check at that time. If MCP isn't reachable, fall back to OpenStreetMap (Overpass API) hiking data or Strava Routes API. Both are free.

**A5. Free-camping data source.**
- **Recommended primary:** Recreation.gov API (free, official, US federal land — covers a lot of free dispersed camping on USFS / BLM land)
- Secondary candidates investigated at Phase 5: iOverlander (community-sourced data export), The Dyrt (some free listings), USFS Motor Vehicle Use Maps for dispersed camping.

**A6. Phasing.**
| Phase | Scope |
|---|---|
| 0 | Bootstrap (project, sheet schema, OAuth, historical CSV import) |
| 1 | Platform skeleton + outdoor inventory ingest (no agent yet) |
| 2 | Outdoor agent v1 (Telegram, no external integrations) |
| 3 | Outdoor + Weather |
| 4 | Outdoor + AllTrails (or fallback) |
| 5 | Outdoor + Free camping |
| 6 | Web UI (read-only, all domains) |
| 7+ | Second domain (deferred until Phase 6 in daily use ≥1 month) |

7-day soak test between Phase 1 and Phase 2 is non-negotiable.

**A7. Folder rename.**
- Current folder: `outdoor-inventory/`
- Recommended new name: `ledger/` (short, accurate, ages well across domains)
- **Decision deferred** — Tom will decide whether/when to rename. No code impact either way.

---

## Outstanding inputs Tom owes the project

These don't block planning but block specific build tasks. Tracked here for visibility:

- [ ] Historical purchases CSV (blocks Task 0.5)
- [ ] 5–10 sample emails forwarded for fixtures (blocks Tasks 1.2, 1.3)
- [ ] Telegram bot token via @BotFather (blocks Task 1.8)
- [ ] Telegram chat ID — get from `/start` to bot (blocks Task 1.8)
- [ ] Anthropic API key (blocks Tasks 1.3, 2.4)
- [ ] GCP project + OAuth credentials, with consent screen *published* (blocks Task 0.2)
- [x] ~~OpenWeatherMap API key OR decision to use NOAA~~ → **Pirate Weather + Nominatim** chosen and shipped 2026-05-15 (Phase 3)
- [ ] AllTrails MCP availability check from Railway deploy (blocks Task 4.1; decide start of Phase 4)
- [ ] Recreation.gov API key (blocks Task 5.1; decide start of Phase 5)

---

---

## 2026-05-01 — Outdoor agent reframed as broad outdoor companion

**Decision:** The outdoor agent's role is broadened from "gear advisor" to "outdoor companion / guru." It is now scoped to handle anything outdoor-related — gear, trip planning, picking up new activities (mountain biking, surfing, climbing, etc.), training advice, where-to-go suggestions, technique pointers, buying decisions — across hiking, backpacking, mountain biking, climbing, skiing/snowboarding, paddling, surfing, trail running, and other outdoor activities.

**Why:** Tom asked "what if I want to take up mountain biking or plan a surf trip to Australia?" — the original "gear advisor" framing was too narrow. Sonnet 4.6 already has broad outdoor knowledge in its training data; the agent doesn't need new infrastructure to answer activity questions, just a broader system prompt. The unique value (vs. a generic chatbot) is the combination of broad outdoor knowledge with Tom's specific inventory grounding — and that moat compounds over time as Tom takes up new activities and logs related purchases.

**How to apply:** No architecture change. Outdoor remains a single domain with a single agent. System prompt rewritten to position the agent as a companion across all outdoor activities. Activity-specific knowledge gaps (current conditions, current product releases, etc.) are filled by the web_search tool (Phase 2.5).

---

## 2026-05-01 — Add `web_search` to outdoor agent as Phase 2.5

**Decision:** Anthropic's built-in `web_search` server tool is added to the outdoor agent's tool registry as a new Phase 2.5 (between agent v1 and weather integration). Single-day deploy.

**Why:** Without web search, the agent is limited to Sonnet 4.6's January 2026 training cutoff. Adding web_search lets the agent ground recommendations in current product reviews, current trail/snow/surf conditions, current pricing, recent gear releases. ~1 day of work; meaningful capability uplift; covers the long tail of activity-specific queries that don't justify dedicated integrations.

**How to apply:** Add `web_search` to the tool list in `domains/outdoor/agent.ts`. Update system prompt to mention "search the web when the user asks about current conditions, current prices, recent product releases, or anything that may have changed since your training cutoff." No additional API key needed (server-side tool — Anthropic executes the search).

---

## 2026-05-01 — AllTrails covers all trail-based activities (hiking, MTB, trail running)

**Decision:** Phase 4's trail integration uses AllTrails as the single source for hiking, mountain biking, and trail running. The trail-client filename in `domains/outdoor/integrations/` is `trails.ts` (activity-agnostic), not `alltrails.ts` (which would be misleading if we end up on the OSM fallback).

**Why:** Tom explicitly chose AllTrails as the trail-data source for all activities including MTB. AllTrails has MTB and trail-running data in addition to hiking. Tom rejected adding Trailforks (MTB-specific) — keeps tool-list minimal and consistent.

**How to apply:** Tool functions accept an optional `activity` parameter (`'hiking' | 'mtb' | 'running'`) for filtering. If MCP isn't reachable from Railway, OSM fallback uses `cycleway` / `mtb:scale` tags for MTB and `highway=path` + `sac_scale` for hiking. Update agent system prompt to advertise coverage of all three activities.

---

## 2026-05-01 — NOT building: Trailforks, Surfline, Magic Seaweed, activity-specific APIs

**Decision:** No dedicated MTB-trail API (Trailforks), no dedicated surf-forecast API (Surfline / Magic Seaweed / similar), no other activity-specific integrations beyond what's already in the plan (Weather + AllTrails + Free-camping).

**Why:** Tom explicitly rejected both. The combination of (a) AllTrails for trails, (b) Weather for forecasts, (c) web_search for everything else covers his use cases without committing to N more integration projects. Each additional integration is its own maintenance burden, auth flow, rate-limit consideration, and template-fragility risk; the marginal value beyond web_search is low for these specific cases.

**How to apply:** When future-Claude is tempted to add a "while we're here" surf or MTB API: don't. Web_search handles it. Revisit only if a specific use case repeatedly fails web_search and Tom explicitly asks.

---

## 2026-05-01 — Full custom build chosen over Claude Project / hybrid

**Decision:** Build the full custom application as planned (Phases 0 through 6+). Do **not** use a Claude Project as the agent layer, and do **not** pursue a hybrid (build the ingest cron only + use a Claude Project for the agent).

**Why:** The hybrid was honestly evaluated and surfaced to Tom as a faster, cheaper alternative — Claude Projects can deliver ~80% of the agent value with ~0% of the engineering, since claude.ai already provides web search, AllTrails MCP, Gmail/Drive connectors, mobile UI, and persistent context. The hybrid would have skipped Phases 2–6 and only built the email-ingest cron (Phase 0 + Phase 1, ~1 week of work).

Tom chose the full build anyway. The full build is justified by:
- **Telegram as the primary interface** — chat with the agent from anywhere, including while shopping IRL, without opening claude.ai
- **Bot-mediated write-back** — "I lost my Jetboil" automatically updates Status in the sheet, no manual sheet editing
- **Single agent that knows ALL domains at once** — vs. a separate Claude Project per domain (loses cross-domain context)
- **Building / learning value** — Tom wants to build this

**How to apply:** When future Claude sessions are tempted to suggest "why not just use a Claude Project for this?" — the answer is documented here. Tom considered it, the tradeoffs were laid out explicitly, and he chose the full build. Don't relitigate.

---

---

## 2026-05-01 — Status enum extended with `retired`

**Decision:** Add `retired` to the Status (column M) enum. Meaning: "still own it but not actively using it." Distinct from `excluded` ("don't include in inventory analysis at all").

**Why:** Tom uses (and will use) gear that he keeps but cycles out of active rotation — older boots that still work, a previous-generation shell, etc. A separate state lets the agent answer "what do I actively use?" (filter `active`) vs. "what do I own?" (include `active` + `retired`) cleanly.

**How to apply:** Update the Status enum everywhere it's referenced (sheet schema, dedup, agent system prompt, slash commands). Default for new rows is still `active`. Agent's default inventory queries filter to `active` unless context suggests otherwise.

---

## 2026-05-01 — Slash commands added to Phase 2 (`/log`, `/lost`, `/sold`, `/donated`, `/retired`, `/broken`)

**Decision:** Phase 2 includes a small set of slash commands on the Telegram bot for fast purchase logging and lifecycle updates. New Task 2.5: `/log <free-form text>` for manual purchase entry; `/lost`, `/sold`, `/donated`, `/retired`, `/broken <item>` for fast Status updates.

**Why:**
- `/log` covers the entire class of purchases that don't come through Gmail (in-store cash, marketplace, gifts received). Without this, the inventory has blind spots.
- Status commands are syntactic sugar over the agent's existing `update_status` tool — faster than typing a full sentence. Useful in the field when Tom is busy.

**How to apply:** Implement in `apps/bot/handlers.ts`. `/log` parses free-form text via Claude (returning structured fields) and asks for confirmation before writing. Status commands fuzzy-match against existing inventory, ask for clarification if multiple matches.

---

## 2026-05-01 — Phase 3.5 added: Calendar-aware trip prep

**Decision:** New mini-phase (~3 days) between Phase 3 (Weather) and Phase 4 (AllTrails). A daily cron reads Tom's Google Calendar, identifies upcoming outdoor events, and proactively sends a Telegram packing-list nudge that combines event + forecast + inventory.

**Why:** This is one of the features that uniquely justifies a custom build over a Claude Project. Projects can't run scheduled background tasks against your calendar. The combination of calendar + weather + inventory + Claude reasoning is the "system earns its keep" moment.

**How to apply:** OAuth scope expansion required (`calendar.readonly`) — re-run `scripts/auth.ts` once. New `lib/calendar.ts`. New `apps/cron/trip-prep.ts` runs daily, separate from the email-ingest cron. De-dupe via small state-tracking sheet tab so the same event isn't nudged twice.

---

## 2026-05-01 — Phase 5.5 added: Gear age / maintenance nudges

**Decision:** New mini-phase (~1 day) between Phase 5 (Free camping) and Phase 6 (Web UI). Monthly cron scans inventory, applies category-based age/maintenance rules (boots 3–5 yrs, shells 18mo for DWR, climbing rope 5 yrs, helmets 5 yrs, etc.), and sends a single consolidated Telegram message with items needing attention.

**Why:** Promoted from the v2 candidate list. Tom explicitly wants this. It's small (rules engine + monthly cron), uses existing Telegram + inventory infra, and adds proactive value that Projects can't deliver.

**How to apply:** Rules engine in `domains/outdoor/maintenance.ts`. Acknowledged-flag tracking in a "Maintenance Acked" sheet tab so items don't re-flag every month. Keep messages concise (≤10 items per message; prioritize oldest if more).

---

## 2026-05-01 — Explicitly NOT building (consolidated list)

**Decision:** The following were considered and explicitly rejected. Do not propose adding them without an explicit user request.

- **Strava integration** (correlate gear with activity miles) — Tom rejected
- **Resale-value advisor** (estimate eBay/Marketplace prices) — Tom rejected
- **Photo / receipt OCR logging** — replaced by typed `/log` command
- **Weekly Telegram digest** (in addition to per-run digest) — per-run digest from Phase 1 is sufficient
- **Voice notes via Telegram** — typed `/log` is fine
- **iMessage relay / Apple Shortcuts** — out of scope
- **Multi-person mode** (partner's gear, lend/borrow) — out of scope
- **Specialist sub-agents within outdoor** (separate trip-planner vs. gear-advisor) — overkill; one agent with good tools wins
- **Tax categorization** — not relevant to Tom's situation
- **Trailforks** — AllTrails covers MTB
- **Surfline / Magic Seaweed** — web_search covers surf

**Why this matters:** These came up in conversation and were evaluated against Tom's stated goals. Capturing them here prevents future Claude sessions from re-suggesting them in a fresh context.

---

## 2026-05-01 — Sheet schema gains `Product URL` (col O); admin UX hardened

**Decision:** Add column O `Product URL` to the `All Purchases` tab. The sheet now has 15 columns (A–O). Concurrently, `scripts/bootstrap-sheet.ts` will install (a) a data-validation dropdown on column M (Status) covering the locked enum, and (b) a conditional-formatting rule that visually mutes rows where `Status != active`.

**Why:**
- Tom asked for a way to click through to a product page from the sheet to manually verify items (still sold? correctly captured?). A URL column is the simplest answer. The link is for *human* verification only — the agent does not use it to reason. (Agent uses `web_search` for "is this still sold" type questions starting Phase 2.5.)
- Tom is the admin and will edit the sheet directly when convenient — historical cleanup, bulk re-categorization, marking items lost/sold faster than via Telegram. Even after Phase 2 adds slash commands, sheet edits remain a first-class path. Making them ergonomic (dropdown enum, visual mute) prevents silent typos that would corrupt agent queries (e.g. typing `lost` as `Lost` and the agent counting the item as still owned).
- `excluded` keeps its existing meaning ("don't include in inventory analysis at all"). Soft delete preserves the audit trail and prevents the cron from re-ingesting the same email and resurrecting the row.

**How to apply:**
- `lib/parsers/types.ts`: `ParsedItem` gains optional `productUrl: string | undefined`.
- `lib/parsers/rei.ts`: extract product `<a href>` per line item.
- `lib/parsers/amazon.ts`: extract product link from shipment-confirmation when present; leave blank when absent. Do *not* synthesize a URL from the ASIN if not seen in the email body. Haiku fallback's JSON schema includes `productUrl` as optional.
- `scripts/import-history.ts`: read `Product URL` from CSV if the column header exists; blank otherwise.
- `scripts/bootstrap-sheet.ts`: add col O header; apply data validation on col M (whole column, reject-on-invalid); add conditional-formatting rule for `M != "active"` rows.
- `lib/sheets.ts`: append-row helper now writes 15 columns instead of 14.
- Dedup key is unchanged: `(Order ID, Item Name, Color, Size)`. `Product URL` is *not* part of dedup.
- Agent default inventory queries continue to filter `Status = active`. `excluded` items remain hidden even from "what do I own (including retired)" queries.

---

## 2026-05-01 — Source sheet has 3 tabs, not 1; consolidate via migration script

**Decision:** Tom's existing spreadsheet has three tabs, not the single `All Purchases` tab the original spec assumed:
- `REI Summary` — ~20 rows of free-form summary text (charts/aggregates), col A only
- `REI All Purchases` — ~82 raw line-item rows, 11 cols (Year, Date, **Exclude**, Category, Sub-Category, Brand, Item Name, Color, Size, Qty, Price)
- `Amazon Purchases` — ~311 raw line-item rows, 7 cols (Year, Date, Category, Item Name, Unit Price, Quantity, Order ID)

We're consolidating into a single `All Purchases` master tab via a one-time migration script (`scripts/migrate-to-master.ts`). The migration replaces what was originally Task 0.5 (CSV import) — Tom doesn't need a CSV; his existing tabs *are* the historical data. Existing tabs are left untouched as a safety net.

**Why one master tab:**
- Agent inventory queries are one read, not three — same applies to dedup, the cron pipeline, and the Phase 6 web UI.
- Adding a future retailer (Patagonia, Backcountry, …) becomes a new value in the `Source` column, not a new tab + code path.
- Conditional formatting + data validation are applied once.
- Per-source tabs would have forced every code path that touches inventory to be tab-aware. Significant downstream complexity for minimal upside.

**Sub-decisions locked in this session:**

| # | Question | Decision |
|---|---|---|
| 1 | How to backfill Amazon's missing depth (no Sub-Category / Brand) | **Use Claude Haiku 4.5 to enrich Amazon rows during migration** — assigns Domain + Category + Sub-Category + Brand using REI's existing taxonomy as the seed vocabulary, with prompt caching on the system prompt + vocabulary. ~$0.50 / ~5 min for 311 rows. |
| 2 | REI category vocabulary | **Keep as-is.** REI's existing categories (e.g. "Ski/Snow Gear", "Gloves & Mittens", "Membership") become the canonical seed vocabulary that the Amazon classifier maps into. New categories allowed when nothing fits. |
| 3 | `REI Summary` tab | **Leave alone for now.** May be deleted or rebuilt as formulas over the new master tab in Phase 6. |
| 4 | Existing `Amazon Purchases` + `REI All Purchases` tabs after migration | **Leave as-is.** Easy rollback if migration has bugs. May be archived/renamed/deleted later once the master tab is verified in production. |
| 5 | Original Task 0.5 (CSV import) | **Replaced by `scripts/migrate-to-master.ts`.** Tom doesn't have a CSV to provide — his existing tabs are the source. |

**Phase blurring acknowledged:** Using Haiku to classify Amazon rows during the Phase 0 migration is technically Phase 1 classifier work brought forward. Justified because: (a) the migration needs *some* classification anyway, (b) the same Haiku prompt + vocabulary will be reused by the Phase 1 Amazon parser, so this isn't throwaway code — it's a head start, (c) Tom will have rich, queryable data from day one rather than blank columns until the proper classifier ships. Does not violate the Golden Rule (still all Outdoor focus, no second-domain code).

**How to apply:**

- `scripts/migrate-to-master.ts`:
  - Reads existing REI All Purchases (cols A–K) and Amazon Purchases (cols A–G).
  - Reads REI's distinct (Category, Sub-Category, Brand) values to build a seed vocabulary that's passed to Haiku in a prompt-cached system message.
  - For each REI row: maps directly into the 15-col schema. Date `Jan 26, 2022` → `2022-01-26`. Price `$89.95` → `89.95`. **Source = "REI"**, Order ID = blank, **Status = "excluded" if REI col C "Exclude" = "Yes" else "active"**, **Domain = "Outdoor"**, Product URL = blank.
  - For each Amazon row: maps the explicit fields. Date `4/30/2026` → `2026-04-30`. Price `$79.95` → `79.95`. **Source = "Amazon"**, Order ID preserved, Status = "active". Then sends item name + Amazon's existing Category to Haiku to fill **Domain** (`Outdoor` or `Other`), **Category** (prefer REI vocabulary, allow new), **Sub-Category** (prefer REI vocabulary or blank), **Brand** (extract from item name).
  - Writes to a new `All Purchases` tab (created if missing). Existing tabs are not modified.
  - **Dry-run by default.** Prints a sample of converted rows and a summary; only writes when re-run with `--apply`.
  - Idempotent on re-run with `--apply`: if `All Purchases` already has data, the script aborts with a clear error rather than appending duplicates. To re-migrate, delete the existing `All Purchases` tab first.
- `scripts/bootstrap-sheet.ts`: unchanged. Run *after* a successful migration; it'll find the new `All Purchases` tab and apply validation + formatting + create `Needs Review`.
- Original Task 0.5 (`scripts/import-history.ts`) is removed from the plan.
- Dedup behavior for historical REI rows: blank Order IDs mean dedup falls back to `(Item Name, Color, Size)` for those rows. New REI rows ingested in Phase 1 will have proper Order IDs from the email parser.

---

## 2026-05-01 — Tightened Domain semantics + new `Type` column (P) + `Reasoning` column (Q)

**Context:** First migration dry-run revealed Haiku was over-classifying as `Outdoor` based on "outdoor people use this" reasoning — e.g. Gatorade got tagged Outdoor because outdoor-active people drink it on hikes. Tom flagged this as the wrong mental model.

**The reframe — what `Domain` actually means:**

`Domain` is *"which expert agent cares about this item for advisory purposes,"* **not** *"which activity context is this used in."* The platform's moat is a clean inventory of **non-consumables** (durable gear) that domain agents reason over to give expert advice. The outdoor agent doesn't need to know about Gatorade purchases when answering "what should I bring on this trip?" — it needs to know about tents, sleeping bags, base layers.

**Decision 1: Add column P `Type`** with three values:

- **`Gear`** — durable owned items (clothing, equipment, electronics, tools). The agent's grounding for "what do I own?" inventory queries.
- **`Consumable`** — food, drink, supplements, sunscreen, batteries, anything used up. Tracked for spend; ignored by default agent inventory queries.
- **`Service`** — memberships, subscriptions, repairs, maintenance, race entries, ski tickets, experiences. May be agent-relevant (e.g. "you're an REI member, you get the discount") but distinct from gear inventory.

Three values is intentionally tight. Tom can edit any cell to add new values via the data-validation dropdown later if needed (e.g. `Media` for books) — start simple.

**Decision 2: Tighten Outdoor classification rules:**

- `Outdoor` = durable outdoor *gear* (clothing, equipment, electronics specific to outdoor activities) + outdoor-specific *services* (REI Membership). Period.
- Consumables — even outdoor-branded ones like Honey Stinger waffles or energy gels — go to `Other` regardless of how outdoor-active people use them.
- "When in doubt → Other." Wrong-`Other` is fixable in seconds via the dropdown; wrong-`Outdoor` pollutes agent reasoning.
- The Haiku prompt explicitly calls out Gatorade as the canonical anti-pattern.

**Edge case rulings (locked here so we don't re-litigate):**

| Item | Type | Domain | Why |
|---|---|---|---|
| Energy gels, trail food, Gatorade | Consumable | Other | Used up; not part of gear inventory. |
| Sunscreen, bug spray, lip balm | Consumable | Other | Same. |
| Replacement bike tube | Gear | Outdoor | Durable spare; part of bike kit. |
| Replacement tent pole | Gear | Outdoor | Same logic. |
| Climbing chalk | Consumable | Other | Used up over time. (Tom can flip later if he wants chalk in his climbing kit inventory.) |
| Batteries (AA, lithium camera) | Consumable | Other | Used up. |
| Headlamp | Gear | Outdoor | Durable. |
| Bike (any) | Gear | Outdoor | Durable. |
| REI Membership | Service | Outdoor | Outdoor-specific service. |
| Strava annual subscription | Service | Outdoor | Outdoor-specific software service. |
| Race entry, ski lift ticket | Service | Outdoor | One-time outdoor experience. |
| Bike tune-up at LBS | Service | Outdoor | Maintenance on outdoor gear. |
| Books, magazines | Gear | Other | Durable items but not agent-advised on as gear; classify as Other unless future Photography/cookbook context promotes it. |

**Decision 3: Add column Q `Reasoning`:**

One-sentence explanation Haiku writes alongside each Amazon classification. Helps the admin understand *why* something landed where it did and quickly spot bad classifications. Trade-off accepted: ~30% more output tokens, ~$0.15 extra cost per migration run, +1 column of sheet visual noise. Worth it for explainability while the system is being tuned. REI rows leave `Reasoning` blank since their classification is mechanical.

**Decision 4: Admin correction workflow.**

Three layers:

1. **Direct sheet edit (always available, primary mechanism).** `bootstrap-sheet.ts` installs data-validation dropdowns on **Status (M), Domain (N), and Type (P)**, all reject-on-invalid. Admin clicks a cell, picks new value, done.
2. **Bulk reclassification script (build when needed).** When a pattern of misclassifications shows up (e.g. "all my workout shirts should be Outdoor/Gear"), write a small `scripts/reclassify.ts` that takes filters and applies updates. YAGNI until first request.
3. **Telegram slash command (Phase 2+).** `/reclassify <item> <field>=<value>` for in-the-field corrections from the bot.

**How to apply (deltas to other artifacts):**

- `CLAUDE.md`: schema row updated to "17 columns A–Q".
- `PLAN.md`: schema table gains rows for P and Q; Task 0.4 lists the three dropdowns; Task 0.5 spec mentions the tightened Domain rules + Type field + Reasoning field.
- `scripts/bootstrap-sheet.ts`: TOTAL_COLS = 17; EXPECTED_HEADERS gains `Type` and `Reasoning`; adds dropdown requests for col N (Domain enum) and col P (Type enum) in the same batch as the existing col M dropdown; conditional-formatting range extended to A:Q.
- `scripts/migrate-to-master.ts`: `MasterRow` interface gains `type` + `reasoning`; Haiku JSON schema gains `type: enum["Gear","Consumable","Service"]` + `reasoning: string`; system prompt rewritten with the strict Outdoor definition and the edge-case table above as worked examples; `writeMasterRows` writes 17 columns; sample printer shows `type` field.
- Dedup key unchanged. Status enum unchanged. Domain enum unchanged in values, only in *meaning*.

---

## 2026-05-01 — Product URL is always non-empty; fallback to search/order-detail URLs

**Context:** After Phase 0 migration completed, Tom flagged that reviewing 393 rows without clickable links was painful. The schema already reserved column O for `Product URL`, but historical-import rows had no URL data so the column was uniformly blank. We needed a synthesized URL good enough for "click and verify what this item actually is."

**Decision:** **Product URL (col O) is always non-empty for valid items.** Populated in priority order:

1. **Real product URL extracted from the source email** — preserved verbatim by the parser (REI: `<a href>` on product image/name; Amazon: `amazon.com/gp/product/<ASIN>` links when present in shipment emails).
2. **Fallback URL** via `lib/url-fallback.ts` → `buildFallbackProductUrl({ source, orderId, itemName })`:
   - Amazon + Order ID known → `https://www.amazon.com/gp/your-account/order-details?orderID=<ID>` (lands on the actual order page when logged in)
   - Amazon w/o Order ID → `https://www.amazon.com/s?k=<URL-encoded item name>` (Amazon search)
   - REI → `https://www.rei.com/search?q=<URL-encoded item name>` (REI search; their catalog is small enough that name-search lands on the right product ~90% of the time)
3. Empty string only as a last resort (e.g. degenerate row with no item name).

**Why this two-tier approach:**

- A real URL is always preferable when available — direct, stable, captures any retailer-specific tracking.
- The fallback covers the "we don't have a real URL" case (historical migration, Amazon emails that omit per-line product links) without resorting to scraping (forbidden per CLAUDE.md) or paying an LLM to web-search every item (~$10+ for 393 rows, variable quality).
- Search/order-detail URLs aren't precise but they're zero-cost, deterministic, and click-through-able — which is exactly what's needed for human review.

**How to apply (already done for current state, locked for future):**

- `lib/url-fallback.ts`: pure function `buildFallbackProductUrl({ source, orderId?, itemName }) → string`. Exports `Source` type alias. Imported by migration, backfill, and (per Phase 1 spec) parsers.
- `scripts/backfill-urls.ts`: one-time script that reads `All Purchases`, fills empty col O via the fallback util. Idempotent — won't overwrite existing URLs. Already run; populated all 393 historical rows.
- `scripts/migrate-to-master.ts`: now calls `buildFallbackProductUrl` when constructing both REI and Amazon master rows (and in the Haiku-fallback path), so any future re-migration ships URLs.
- `lib/parsers/rei.ts` (Phase 1, Task 1.2): extract real URL from email; if absent, call fallback util. `productUrl` becomes a required (non-optional) field on `ParsedItem`.
- `lib/parsers/amazon.ts` (Phase 1, Task 1.3): same pattern. Haiku fallback's JSON schema keeps `productUrl` optional, but the wrapper applies fallback if Haiku returns empty.
- `PLAN.md` sheet schema row O updated; Tasks 1.2 + 1.3 updated to reference the fallback helper.
- This decision **does not** affect dedup (`(Order ID, Item Name, Color, Size)` unchanged) or any other column.

**Implication for future retailers** (Patagonia, Backcountry, MEC, etc.): each new parser must either extract a real URL or the fallback util needs a corresponding case added. Default fallback: `https://<retailer-domain>/search?q=<item name>`.

---

## 2026-05-01 — Domain set expanded to 11; consumables-by-domain rule (supersedes part of prior entry)

**Context:** Second migration dry-run with the previous 2-domain (Outdoor/Other) setup revealed a structural limitation. With only Outdoor and Other, the catchall got crowded and the model couldn't position items for *future* domain agents (camera mentor, kitchen advisor, fitness coach, etc.). Tom asked to "nail out all the categories now so as it updates there is better architecture."

Separately, Tom corrected my read of consumables: domain-specific consumables (climbing chalk, ski wax, camera batteries) **should** stay in their domain, not get banished to a generic catchall. The reason: the future "Phase 5.5+" proactive-nudge use case ("ski season is coming, you have ~25% wax left, restock?") requires the domain agent to *see* its own consumables. A consumable hidden in `Other` is invisible to the domain agent.

**Decision 1: Expand Domain enum to 11 values.**

The existing 8 (`Outdoor`, `Other`, `Kitchen`, `Photography`, `Home`, `Tech`, `Wardrobe`, `Auto`) gain three new ones based on observed Amazon-purchase patterns:

| Domain | What goes here | Future agent |
|---|---|---|
| **Outdoor** | Hiking, backpacking, camping, climbing, MTB, skiing, paddling, surfing, trail-running gear; outdoor-specific services (REI Membership, race entries, ski tickets); outdoor-specific consumables (energy gels, ski wax, chalk, bear spray, sunscreen for trips). | Outdoor mentor (Phase 2+) |
| **Photography** | Cameras, lenses, tripods, bags, lighting; photography software/courses; consumables for photo gear (camera batteries, memory cards, sensor swabs, lens cleaning fluid). | Camera mentor |
| **Kitchen** | Cookware, bakeware, appliances (Instant Pot, blender), utensils; **food and drink consumables** consumed at home (oils, spices, coffee beans, pasta, baking ingredients, **all home-consumed beverages including Gatorade and protein shakes — Category="Drinks"**). | Kitchen / pantry advisor |
| **Home** | Furniture, bedding, bath, decor, lighting (non-outdoor), DIY/repair tools; home consumables (dish soap, paper towels, laundry detergent, light bulbs, household batteries). | Home advisor |
| **Tech** | Computers, monitors, keyboards, audio gear, networking, smart-home, generic electronics, software subscriptions (non-outdoor). | Tech advisor |
| **Wardrobe** | Casual / dress / work clothing, dress shoes, accessories like watches & belts (non-outdoor, non-athletic). | Wardrobe stylist |
| **Auto** | Car parts, maintenance, accessories, car-specific tools. | Car advisor |
| **Fitness** *(new)* | Gym equipment, yoga gear, weights, athletic clothing not specifically outdoor (workout shirts, gym shorts). | Fitness coach |
| **Health** *(new)* | Generic body-care consumables: vitamins, supplements, OTC meds, generic personal-care items (toothpaste, generic lip balm). NOT activity-specific consumables (those go to Outdoor / Fitness). | Health advisor |
| **Media** *(new)* | Books, magazines, courses, music/video subscriptions. | Reading / learning advisor |
| **Other** | True catchall — pet supplies, garden, gifts, hobbies that don't fit a domain. | — |

**Decision 2: Domain-specific consumables stay in their domain (supersedes the "consumables → Other" rule from the prior entry).**

The reframed principle:

> **Domain = which agent cares about this item for advice OR proactive consumable nudges.** *(Not just "which agent owns the gear inventory.")*
> **Type = durable owned (`Gear`) vs used-up (`Consumable`) vs paid-non-physical (`Service`).**

Consumables go to the domain whose agent would benefit from tracking them. Examples:

- Climbing chalk → `Outdoor / Consumable` (outdoor agent nudges before climbing season)
- Ski wax → `Outdoor / Consumable` (outdoor agent nudges before ski season)
- Energy gels, Honey Stinger waffles → `Outdoor / Consumable` (outdoor agent tracks for trip prep)
- Sunscreen / bug spray for outdoor trips → `Outdoor / Consumable`
- Camera batteries, memory cards, sensor swabs → `Photography / Consumable`
- Olive oil, spices, coffee beans, pasta → `Kitchen / Consumable`
- Gatorade, protein shake (home-consumed) → `Kitchen / Drinks / Consumable`
- Vitamins, OTC meds, generic toothpaste → `Health / Consumable` (no specific domain owns these)
- Dish soap, laundry detergent, paper towels, household batteries → `Home / Consumable`

The `Health` domain is now narrower: it's the catchall for body-care consumables that *no other domain* owns. Activity-specific consumables (used during outdoor trips, gym workouts, photography shoots, etc.) belong to that activity's domain.

**Decision 3: `Drinks` becomes the Category for all home-consumed beverages.**

Tom uses Amazon to recurring-order Gatorade and protein shakes for home consumption (not as workout fuel). Both are `Kitchen / Drinks / Consumable`. Future home-drink purchases (juice, sparkling water, soda, beer, etc.) follow the same pattern. Coffee beans stay under `Kitchen / Coffee` (or similar) — Drinks is specifically the prepared-beverage category.

**Decision 4: REI Type heuristic widened to catch wipes / fuel / wax / cleaner / lubricant.**

Previous version of `inferReiType()` in `migrate-to-master.ts` only matched snacks/nutrition/membership and missed obvious consumables in REI's "Camping Gear → Kitchen & Cleanup" sub-category (e.g. dish wipes). Updated heuristic also matches: `wipes`, `fuel`, `wax`, `cleaner`, `lubricant`, `sealant`, `repellent`, `repellant`, `polish`, `chalk`. Catches the long tail; admin can still flip individual rows in the sheet via the Type dropdown.

**How to apply (deltas to other artifacts):**

- `CLAUDE.md`: schema row already says "17 columns A–Q"; no change needed (Domain values aren't enumerated there).
- `PLAN.md`: schema table row N updated to enumerate all 11 domains and reference this entry for consumable semantics.
- `scripts/bootstrap-sheet.ts`: `DOMAIN_ENUM` adds `Fitness`, `Health`, `Media` (8 → 11 values).
- `scripts/migrate-to-master.ts`: `Domain` TypeScript type union expanded to all 11 values; JSON schema `domain` enum likewise; system prompt rewritten with per-domain definitions + consumables-by-domain rule + worked examples (including the Drinks / Gatorade case as the canonical illustration). `inferReiType()` widened per Decision 4. Distribution + sample print updated to handle the larger domain set.
- DECISIONS.md prior entry's "consumables → Other" rule is **superseded** by Decision 2 above.

---

## 2026-05-02 — Outdoor agent inventory retrieval: full-context with compact serialization

Full design: `docs/superpowers/specs/2026-05-02-outdoor-agent-inventory-retrieval-design.md`

**Decisions locked:**

1. **Retrieval architecture: full-context, not retrieval-based.** The Phase 2 outdoor agent receives Tom's entire active outdoor inventory in its system prompt every conversation (Anthropic prompt-cached). No `searchInventory()` tool in v1 — the agent reads, filters, and reasons over the whole list. Sonnet 4.6's reasoning and 200K context make this feasible at current scale.
2. **Compact serialization format.** Drop `Order ID`, `Reasoning`, `Product URL`, full `Date Purchased` from the agent-facing representation. Compress remaining fields. Target ~25-35 tokens per row (vs ~100-150 naïve). At 400 rows this is ~12K tokens; ceiling is ~6,500 rows before hitting the 200K context limit.
3. **Refresh strategy: 15-min timer + content-hash check.** Bot polls the sheet every 15 min, but only invalidates the prompt cache if the row data actually changed (SHA-256 hash). Prevents the cache from going cold ~96 times/day for no reason. Bot self-writes (slash commands) update the in-memory snapshot immediately. `/refresh` slash command forces an immediate refetch.
4. **Conversation lifetime: 30 min idle.** Bot maintains one Claude conversation per Telegram session (messages within 30 min of each other); after 30 min idle, the next message starts a fresh conversation. Bounds conversation history growth.
5. **Status filter: active-only in agent context.** Only `Status=active` rows are sent to the agent. Non-active rows (retired/returned/lost/broken/sold/donated/excluded) are not in the agent's view in v1. Defer a `getNonActiveItems(status?)` tool until a real use case appears.
6. **Soft threshold for hybrid mode.** When ≥ 2 of 4 signals fire — inventory ≥ 2,000 rows, monthly cold-cache cost > $30, cold first-token latency > 8s, free conversation context budget < 40K tokens — flip to a hybrid pattern (Tier 1 inventory summary in cached system prompt + Tier 2 `searchInventory()` tool). Until then, do not pre-build the hybrid pattern.
7. **Instrumentation now, hybrid later.** Build a `/stats` slash command + per-query / per-refresh / per-session logging in v1 so we can detect threshold hits without guessing.

**Why:**

Tom asked the right question — categorization in the sheet is leaf-specific (good for human browsing, bad for agent retrieval). Three approaches were considered: (a) full-context, (b) tool-based retrieval, (c) hybrid. At ~400 rows and a single user, (a) is dramatically simpler and cheaper than (b) — no tool surface to design, no tag taxonomy to maintain, no risk of the agent picking wrong filters and missing items. Estimated current cost: ~$5/month. Threshold-driven evolution to (c) preserves the option without paying its complexity tax up front.

**Why active-only:** Tom doesn't want the agent confused by gear he no longer uses. Reduces tokens further (~10-20% at current size). Trade-off accepted: agent can't answer "what did I return last year?" until the deferred tool ships.

**Why 30-min conversation lifetime:** matches a natural break in user attention; long enough that follow-up Telegram messages stay in the same conversation (cache stays warm); short enough that conversation history doesn't accumulate forever.

**How to apply (deltas to other artifacts):**

- `docs/PLAN.md`: Phase 2 task list updated. New Task 2.3 covers inventory cache + compact serialization + instrumentation. Task 2.4 (agent) tool list slimmed — no `search_inventory`, `get_spending`, `summarize_by_category`, or `get_item_details` in v1 (agent has full inventory in context). Task 2.6 ship gate adds threshold-status check via `/stats`.
- `CLAUDE.md`: no change required; the architectural rule "lib/ is pure infrastructure, domain/ is domain-specific" already accommodates the new files (`apps/bot/inventoryCache.ts`, `apps/bot/stats.ts`, `domains/outdoor/serialize.ts`).
- Implementation gated on Phase 1 soak completing cleanly (target 2026-05-08).

---

## 2026-05-02 — Sender-drift audit

**Decision:** Add a weekly Gmail audit that runs alongside the existing Sunday-morning cron tick. Two checks (sender drift, subject drift). Telegram-only output, fires only when something is flagged. No state.

**Why:** Hardcoded sender allowlist (`rei@notices.rei.com`, `auto-confirm@amazon.com`, `shipment-tracking@amazon.com`) means a silent under-count if Amazon or REI ever change senders or subject conventions. Failure mode is invisible without an external check.

**Why not broader filter:** Loosening the main pipeline to `from:amazon.com` would pull in promo / return / account email and require new noise-filtering. The audit gives us drift detection without changing the ingest path.

**Why no state:** Keeps the audit a pure function — easy to test, easy to reason about. Sample cap (10 per check) prevents Telegram spam if drift is widespread. Per-message Gmail fetch errors are counted into `fetchErrors` and surfaced in the digest, so a partial-failure run still produces signal rather than silently skipping.

---

## 2026-05-14 — REI preference encoded in agent prompt, not ingest scope

**Decision:** When the outdoor agent recommends purchases, it prefers REI over other retailers when both carry the item. Encoded as a single line in the Phase 2.4 system prompt — no change to ingest scope, parsers, or data model.

**Concrete prompt addition (Phase 2.4):**

> When recommending purchases, prefer REI when both retailers carry an item — Tom is a co-op member and that's his default store. Mention the dividend or return-policy advantage in close calls.

**Why not drop Amazon ingestion:** Both parsers ship and work. Tom buys outdoor gear on Amazon historically (Black Diamond, etc.), so killing Amazon would create silent gaps. Operating cost delta is ~pennies/month. The "active" curation already filters at the inventory level — source doesn't matter to the agent.

**Why not build REI-deep features now:** REI member-dividend tracking, return-window watching, Co-op Camp integration, etc. are "additional retailer features" — same Phase 7b bucket as adding Patagonia / Backcountry / MEC. Building any of these before Phase 6 ships violates the golden rule.

**How to apply:** Add the prompt line to `domains/outdoor/agent.ts` when Task 2.4 is implemented. No other code or doc changes needed.

---

## 2026-05-14 — Outdoor agent v1 design notes (Phase 2.4)

Three implementation choices that aren't bugs but warrant explicit recording so future-Claude understands the invariants behind them.

### Sheet row index = snapshot position + 2

**Where:** `domains/outdoor/tools.ts:update_status` handler.

**What:** To find the spreadsheet row for an item, the tool computes `sheetRowIndex = (cache.getSnapshot().findIndex(r => itemId(r) === id)) + 2`. The +2 is +1 for the header row, +1 for 1-based indexing.

**Invariants this depends on:**
1. `lib/sheets.readMasterRows` reads starting from row 2 (header at row 1).
2. `readMasterRows` returns rows in natural sheet order (no sorting).
3. `readMasterRows` skips fully-blank rows. As long as there are NO blank rows mid-data, snapshot order = sheet order.

**Failure mode:** If a blank row ever appears between data rows in `All Purchases`, `update_status` will silently write to the wrong row. The sheet is append-only in v1 so blank rows shouldn't happen, but it's a latent risk.

**Fix if it ever bites:** Either (a) make `readMasterRows` return absolute row indices alongside data, or (b) re-look up the row by natural key (itemId) at write time by fetching the sheet's current state. (b) is more robust but costs an extra Sheets API call per write.

### `firstTokenMs` is full-response latency, not time-to-first-token

**Where:** `domains/outdoor/agent.ts:OutdoorAgent.handleMessage`, `apps/bot/stats.ts:Stats.coldFirstTokenP50Ms`.

**What:** The agent records `firstTokenMs` from `Stats.recordQuery({ firstTokenMs })`. The value is `Date.now() - callStart` around the first non-streaming `anthropic.messages.create` call.

**Why the name doesn't match:** Anthropic's SDK supports streaming (`stream: true`) which would give true time-to-first-token, but we chose non-streaming for v1 simplicity. The metric is therefore *full round-trip latency for the first call in the loop*, which is what we actually care about for cost/UX threshold decisions in `evaluateThresholds`.

**If we add streaming later:** Either rename `firstTokenMs` everywhere to `firstCallMs`, or change the measurement to capture only the time-to-first-text-block.

### User message is not persisted to ConversationStore on loop-cap throw

**Where:** `domains/outdoor/agent.ts:OutdoorAgent.handleMessage`.

**What:** If the tool-call loop hits `MAX_TOOL_LOOPS = 8` and throws, the user's message is in the local `messages` array but is NEVER appended to `conversations.append(chatId, ...)`. The conversation store reflects the state as if the user's last message never happened.

**Why:** A loop-cap throw means the model is stuck. Persisting that turn would just confuse the next interaction. Cleaner to let the user retry from a clean state.

**Implications for Task 2.5 (slash commands / bot error handler):** The bot's error handler should surface a "something went wrong, please try again" message but should NOT try to reconstruct conversation state on retry. The retry will be a fresh `handleMessage` call with the user's resent text; the model sees no record of the broken turn.

---

## 2026-05-14 — Upgrade primary agent model to Opus 4.7; supersedes the 2026-05-01 Sonnet 4.6 choice

**Decision:** The outdoor agent's primary model is now `claude-opus-4-7`. The fallback chain on sustained 529 is `claude-sonnet-4-6` → `claude-haiku-4-5`. Constants live in `domains/outdoor/agent.ts` (`PRIMARY_MODEL`, `FALLBACK_MODELS`).

**Why:** The original 2026-05-01 choice of Sonnet 4.6 was a cost/speed compromise. Anthropic's standing guidance is to default to the latest and most capable model; Opus 4.7 is the current Opus release and is the right primary for a knowledge-grounded companion agent (broader knowledge, better reasoning over the inventory + activity questions).

**Cost impact:** Opus 4.7 is roughly 5x Sonnet 4.6 on input pricing ($15 vs. $3 per MTok). For Tom's expected usage (handful of questions/day with prompt caching), this moves the agent from an estimated ~$0.04/month to ~$0.20–0.50/month — still well below the `monthly_cost > $30` threshold in `evaluateThresholds`. Cache-pricing constants in `apps/bot/stats.ts` were updated to match Opus 4.7 (cache-write-5min: $18.75/MTok, cache-read: $1.50/MTok). The fallback steps will use Sonnet or Haiku pricing in reality but `Stats` reports a single set of constants — the overestimate is conservative.

**Policy: always default to the latest Claude model.** When a newer Opus / Sonnet / Haiku releases, update **one file**:

- `lib/models.ts` — contains `MODELS`, `AGENT_PRIMARY_MODEL`, `AGENT_FALLBACK_MODELS`, `PARSER_MODEL`, and `AGENT_PRICING_PER_MTOK`. Every consumer (agent, classifier, migration script, stats, tests) imports from here.

Then add a dated entry in this file noting the bump and the rationale (which model became primary, why, any cost-impact notes). Tests use `AGENT_PRIMARY_MODEL` / `AGENT_FALLBACK_MODELS` directly so they adapt automatically.

There is no Anthropic API for "give me the current latest model," so the model-version check stays a manual maintenance step. Discovery via [docs.claude.com](https://docs.claude.com) on model announcements.

**Earlier (2026-05-14) version of this entry listed 5 places to update.** The 2026-05-14 follow-up consolidated all model + agent-pricing constants into `lib/models.ts`, so the maintenance burden is now one file.

**Earlier-mistake correction:** the prior commit (2026-05-14, `f1cfa49`) introduced a fallback chain containing `claude-opus-4-6`, which is not a real model ID. The smoke test that succeeded did so by skipping past Opus on a 529 and landing on Haiku. This entry corrects both the primary and the fallback names.

---

## 2026-05-14 — Slash commands (Phase 2.5)

**Decision:** 10 slash commands implemented as pure handler functions in `apps/bot/handlers.ts`, dispatched by `dispatchCommand(chatId, text, deps)`. All deps (cache, sheets, anthropic, pendingActions, stats, updateRowStatus, appendMasterRow, extractLogDraft, today) are injected so handlers are unit-testable with mocks.

**Contract for the bot listener (Task 2.1/2.2):** `dispatchCommand` returns `Promise<string | null>`. `null` means "not a slash command — pass to agent." String means "send this to the user." The listener pattern:

```ts
const reply = (await dispatchCommand(chatId, text, deps)) ?? (await agent.handleMessage(chatId, text));
await telegram.sendMessage(chatId, reply);
```

**`/log` confirmation flow:** Two-step. `/log <text>` runs Claude extraction (Haiku for cost) and stores a pending append in `PendingActionStore` (5-min TTL); replies with a preview. `/confirm` pops the pending action and writes; `/cancel` clears it. Re-issuing `/log` overwrites the prior pending (intentional — no stale state).

**Status-change family (`/lost`, `/sold`, `/donated`, `/retired`, `/broken`):** Share one handler. Argument is either an item name (fuzzy match via `findByFuzzyName`) or a 6-char itemId. Multi-match → reply lists IDs and asks the user to specify. No-match → reply asks for clarification. Single match → write via `updateRowStatus` and call `cache.applyLocalChange`.

**`/stats` and `/refresh`:** Thin wrappers over existing `formatStats` and `cache.forceRefresh`.

**Why inject `today: () => string`:** Lets tests pin "today" deterministically. Production passes `() => formatInTimeZone(new Date(), 'America/Denver', 'yyyy-MM-dd')` to stay consistent with Mountain Time semantics established in Phase 0.

**Source schema extension:** Extended `Source` from `'REI' | 'Amazon'` to include `'Other'` (using the same `SOURCE_VALUES` const+derived-type pattern as `Status` and `Domain`). Required because `/log` exists specifically for non-retail purchases (cash, marketplace, gifts). `lib/url-fallback.ts` keeps its own narrower `Source = 'REI' | 'Amazon'` because URL fallback only makes sense for known retailers — different semantic. Worth deduping later if more code needs the broader Source.

**`/log` is hardcoded to Outdoor domain.** The `extractLogDraft` system prompt explicitly assumes Outdoor, and `handleLog` sets `domain: 'Outdoor'`. When a second domain ships (Phase 7+), this needs revisiting — likely a `/log-kitchen` family or a domain-detection step.

**Row index for status change (`/lost` etc.):** Same `position + 2` assumption as the agent's `update_status` tool (documented in the 2026-05-14 outdoor-agent invariants entry). If `readMasterRows` ever skips or reorders rows, both call sites break together.

---

## 2026-05-14 — Telegram bot listener wiring (Phase 2.1 + 2.2)

**Decision:** `apps/bot/index.ts` is the long-running bot process. Polls Telegram every 25s, routes each message through `routeMessage(chatId, text, deps)` in `apps/bot/router.ts`. The router tries `dispatchCommand` first (Phase 2.5 slash commands), falls back to `agent.handleMessage` (Phase 2.4 OutdoorAgent), and catches all throws → generic user-facing error string.

**Cache loaded once at startup** via `cache.start({ refreshIntervalMs: 15 * 60 * 1000 })`. If the initial Sheets read fails, the bot fails fast and exits — Railway will restart it. Better than starting with an empty inventory.

**Authorization:** `TELEGRAM_AUTHORIZED_CHAT_IDS` env var, comma-separated. Single user (Tom) in v1; the comma-separated format is forward-compatible for future shared usage. Bot stores them as `Set<string>` and compares against `String(msg.chat.id)` — Telegram returns numeric IDs but stringifying both sides avoids the most common footgun.

**Offset advanced BEFORE processing.** If a message causes a crash and the outer try/catch kicks in, that message is acknowledged (offset = its update_id + 1) and not re-delivered. Deliberate — re-processing a crashing message would just crash again.

**Long-poll timeout = 25s.** Node 20+ native `fetch` has no client-side timeout, so the Telegram connection holds for the full poll window. If this ever changes (e.g., switching HTTP libs), wire an `AbortSignal` for `POLL_TIMEOUT_S + buffer`.

**Edited messages re-route.** If Tom edits a Telegram message, the bot processes the edited version like a new message. For natural-language queries this is fine (agent re-answers); for slash commands like `/log` it could double-execute. Acceptable for v1 solo use; trivial to disable later by ignoring `update.edited_message`.

**No graceful shutdown.** SIGTERM kills the process; `cache.stop()` is never called. On Railway, the process is just restarted. When the bot grows stateful (e.g., a sheet-side pending-actions store), wire `process.on('SIGTERM', ...)` properly.

---

## 2026-05-14 — Phase 2.5: web_search tool added

**Decision:** Outdoor agent's tool registry now includes Anthropic's server-side `web_search_20260209` tool. Capped at `max_uses: 3` per turn. No domain allowlist/blocklist.

**Why:** Phase 2.6 acceptance answers were "decent" but limited by the Sonnet/Opus training cutoff (January 2026). Questions about current prices, recent gear releases, current trail/weather/snow conditions, or anything time-sensitive returned stale or hedged answers. `web_search` lets the agent verify and ground its responses in current information.

**Why server tool, not client:** Anthropic runs the search server-side and returns results inline. No client-side handler, no separate API key, no new infrastructure. The existing tool-call loop passes through unchanged — `text` blocks get extracted as before, `server_tool_use` and `web_search_tool_result` blocks are filtered out of the dispatch path (verified by the new test in `tests/domains/outdoor/agent.test.ts`).

**Why `max_uses: 3`:** Bounds per-message cost ($0.01/search × 3 = $0.03 max per turn) and prevents the model from searching indefinitely on a vague question. Most outdoor questions need 0-1 searches. The cap can be lifted if the agent starts hitting it during real use.

**Why no allowlist:** Starting unconstrained — Anthropic's search is generally good at filtering low-quality results. If results disappoint (SEO sludge, listicle spam), revisit with a curated allowlist (REI, Backcountry, OutdoorGearLab, Switchback Travel, NPS, USFS, etc.).

**Cost impact:** ~$0.01/search. If ~30% of questions trigger search at ~10 questions/day, that's ~$0.90/month additional. Total agent spend now expected $1-2/month including Opus 4.7 + web_search.

**The `get_product_url` tool is now dead.** Inventory rows include the URL directly (Phase 2.6 UX fix). The tool is left in the registry as a fallback in case a row's URL is empty, but the system prompt deprioritizes it. Worth removing in a future cleanup.

---

## 2026-05-15 — Image-sourced gear capture via `/addgear`

**Decision:** Tom can add already-owned gear (no receipt) by sending a photo to the bot with a `/addgear` caption. A Sonnet 4.6 vision call extracts brand/itemName/color/size/date/price from photo+caption together. A web_search call (parallel to the classifier) returns up to 3 candidate product pages. The bot then prompts for missing fields, runs fuzzy dedup, and parks the row in `PendingActionStore` so the existing `/confirm` writes it. New rows carry `Source = "Image"` and `Order ID = "IMG-<YYYYMMDD>-<6hex SHA-256>"`. Full spec: `docs/superpowers/specs/2026-05-14-image-gear-capture-design.md`. Plan: `docs/superpowers/plans/2026-05-14-image-gear-capture.md`.

**Why a separate flow from `/log`:** `/log` was free-text-only for in-store cash purchases. `/addgear` is photo-driven for gear that exists physically but has no receipt anywhere (gifts, hand-me-downs, pre-ingestion purchases). They share the terminal `PendingActionStore` + `/confirm` step but diverge upstream.

**Why "Image" not "Manual" as the Source value:** Tom's choice (2026-05-14 brainstorm). Photo-sourced is the only manual-entry path right now, and "Image" reads better in the Sheet at a glance. `SOURCE_VALUES` is `['REI', 'Amazon', 'Other', 'Image']`. The Sheet's `Source` column dropdown was updated to include `Image` (one-time manual step).

**Why vision parses the caption, not a separate Haiku call:** Sonnet vision already sees the caption alongside the image. Asking it to *also* extract date/price from the caption is one extra instruction, zero extra round-trips. Earlier iteration used a regex caption parser that was fragile (anchored to start-of-string, missed `LL Bean 12-11-21 $135.15`). Regex is still a fallback if vision misses something obvious.

**Why pre-park the row at preview time:** First UX iteration parked the row in `PendingActionStore` only after the user typed "yes", then asked them to type `/confirm`. Two-step. Tom typed `/confirm` directly per the preview text and got "Nothing to confirm" because the pending store was empty. Fix: park the row the moment we show the preview, so `/confirm` works as the message promises. `handleConfirm` clears `addgearState` after a successful write so it doesn't linger.

**Why always enter the product-pick step (even with 0 candidates):** First iteration silently skipped the pick step when web_search returned no candidates, landing the row with URL blank. Tom hit this with L.L.Bean boots — vision-only item name was wrong (`Bean Boots 8"` instead of the actual model) and there was no chance to supply a URL. Fix: always enter `awaiting-product-pick`. With 0 candidates the bot says "Couldn't find a confident product page — paste a URL or 'skip'".

**Why curated allowed_domains + auto-retry fallback:** The Anthropic web_search tool rejects the *entire* call with 400 if any `allowed_domains` entry is blocked from their crawler. Initial list included `sony.com`, `nikon.com`, `gopro.com`, etc. — all blocked, all of which broke every lookup. Now: trimmed to outdoor-focused retailers and mid-size gear brands. Plus, if Anthropic adds future blocks, `lookupProduct` parses the blocked-domain list from the 400 message and retries with those domains removed (up to 3 attempts). One-time crawler-policy changes upstream no longer require a code push.

**Why URL paste also re-fetches the page for canonical name:** When the user pastes their own URL (because lookup missed), we do a direct HTTP `fetch` of the page and extract the canonical product name from `og:title` (preferred) or `<title>`, strip trailing site-name patterns ("... | REI Co-op", "... – L.L.Bean"), and strip the brand prefix. No LLM call needed — `<title>`/`og:title` is reliable on every major outdoor retailer's product pages. 8-second timeout, presents as a normal browser UA. Silent fallback to vision's name on any failure.

**Two-stage UX flow:** photo + caption → vision (with web_search lookup) → product-pick → (missing-field prompts: date, price) → fuzzy-dedup → confirm-preview → `/confirm`. Cancel works at every step via `/cancel` (clears both `pendingActions` and `addgearState`). Field corrections at the confirm step (`color: olive`, `url: https://...`, `item: Bean Boots Men's 10"`) re-park the patched row so the next `/confirm` reflects the edit.

**Cost per `/addgear` call:** ~$0.02-0.04 (Sonnet vision + classifier + web_search at $0.01/search). Per-call latency: 6–13s (vision and lookup run in parallel after extraction; lookup includes the web_search round-trip). Acceptable for a deliberate-action flow.

**Models referenced:** `VISION_MODEL = MODELS.sonnet` (added 2026-05-14 to `lib/models.ts`). All `/addgear` Claude calls use it. Update when a newer Sonnet ships.

---

## 2026-05-15 — `/addgear` URL in caption is authoritative; photo is a cross-check

**Context:** Tom photographed a pair of Grass Sticks bamboo ski poles with `/addgear https://www.rei.com/product/163187/...` as the caption. Vision couldn't read brand or item name off bamboo, so the bot replied "Couldn't read brand or item name from the photo" — even though the user had handed it the canonical product URL.

**Decision:** When the `/addgear` caption contains a URL, the URL is the authoritative source for brand + itemName. The product-pick step is skipped entirely. Vision still runs but is used only for color/size + a brand sanity-check.

**Why:**
- A URL in the caption is the user explicitly saying "this is the product page" — no need to web-search for candidates.
- For hard photos (bamboo, plain fabric, dark scenes) vision fails completely. The URL bridges the gap.
- A cheap Haiku call on the page `<title>` + URL slug returns `{brand, itemName}` with high accuracy for REI/L.L.Bean/Patagonia/etc.; for Amazon URLs we skip the page fetch (bot-shield) but still let Haiku parse the URL slug.

**How to apply:**
- `lib/parsers/product-lookup.ts: fetchProductInfo(anthropic, url)` — fetches page title (when host isn't on the bot-shield list), passes URL + title to Haiku, returns `{brand, itemName}`.
- `apps/bot/commands/addgear.ts: startAddgearWithUrl()` — when caption has a URL, runs vision + fetchProductInfo in parallel, merges with URL primary for brand/item, vision primary for color/size.
- Cross-check: if both vision and URL return a brand and they share no tokens, the preview is prefixed with `Heads up: photo looks like "X" but URL says "Y" — using URL.` so the user can override via `brand: …`.
- Falls through cleanly to existing date/price/dedup prompts; product-pick step bypassed.

**Trade-off accepted:** if the URL is wrong, no lookup alternatives are surfaced; user corrects via `url: <other>` on the preview. Worth it — the common case (URL is right) is now zero-friction.

---

## 2026-05-15 — Labeled-field "About to log" preview shared by `/addgear` and `/log`

**Context:** The original preview was a dense single-line format: `Brand Item (color, size) / $price, source, date, [category/sub]`. Tom found it hard to scan and asked for `Label: Value` per line.

**Decision:** A single shared helper `apps/bot/preview.ts: formatLogPreview(row)` produces a per-field-on-its-own-line preview used by both `/addgear` and `/log`. Labels exactly match the keys accepted by the `field: value` edit syntax — so the preview doubles as a cheat-sheet.

**Field order:** Item, Brand, Color, Size, Price, Date, Source, Category, Sub-Category, Domain, Type, URL.

**Why:** the most-edited fields (Item, Brand) sit at the top; less-likely-to-be-corrected fields (Domain, Type, URL) at the bottom. Labels mirror correction keys so the user doesn't need a separate help message.

---

## 2026-05-15 — `fetchProductName`: skip Amazon, sanity-check titles

**Context:** A user-pasted Amazon URL was producing rows with `itemName = "Amazon.com"`. Amazon detects our `Mozilla/5.0 (compatible; outdoor-inventory/1.0)` UA and serves a stripped bot-shield page whose `<title>` is the literal string `Amazon.com`. The original suffix-stripping regex only caught patterns like ` | REI Co-op`, not hostname-as-title.

**Decision:**
1. `fetchProductName` returns `null` immediately for `amazon.com` / `amzn.to` / `amzn.com` / `smile.amazon.com` — vision's `itemName` is always better than what the bot-shield page yields.
2. For all other hosts, the extracted title is run through `isJunkTitle()`: rejects titles that equal the source hostname, equal the brand alone, are shorter than 3 chars, or match common bot-shield/error phrases (`Robot Check`, `Sign In`, `Just a moment`, `404`, `Page Not Found`, etc.).

**Why:** vision-extracted item names are accurate for in-photo gear. Refining them against a 200-OK bot-shield page replaces good data with garbage. Better to keep vision's name.

---

## 2026-05-15 — Amazon parser also ingests `auto-confirm` order emails (via Haiku)

> Supersedes [2026-05-01: "Amazon parser sources shipment-tracking only"](#2026-05-01--amazon-parser-sources-shipment-tracking-only).

**Context:** "I have bought things so it's broken." Tom's most recent purchase (Eucalan No Rinse) had been sitting in his Gmail for hours with an `auto-confirm@amazon.com` "Ordered: …" subject, but no row appeared in the sheet because the parser was hard-coded to skip non-shipment Amazon emails. The original assumption ("order emails only show the order total") turned out to be wrong for modern Amazon order emails — they do carry per-line-item prices.

**Decision:** The Amazon parser now handles BOTH email types:
- `parseAmazonShipmentEmail(html)` — sync, cheerio-based, as before (handles the typographic `<sup>$</sup>` price pattern).
- `parseAmazonOrderEmail(anthropic, html)` — async, Haiku-based, extracts `{orderId, items: [{itemName, quantity, price, productUrl}]}` from "Ordered: …" auto-confirm HTML.

Pipeline tries shipment first (cheap, deterministic), falls through to order parser for "Ordered: …" emails.

**Why:**
- Closes the 1–3 day visibility gap between purchase and sheet update — the row appears within ~12 hours of buying instead of within ~12 hours of shipping.
- Haiku cost is negligible (~$0.001 per email).
- Dedup catches the future shipment email arrival via `(orderId, ASIN)` strong key — no double-write.

**Trade-off accepted:** if Haiku misreads an item name in the auto-confirm AND the dedup misses the shipment match, a duplicate row appears. Mitigated by the new ASIN strong key (see next entry).

**How to apply:**
- `lib/parsers/amazon.ts`: exports `parseAmazonShipmentEmail`, `parseAmazonOrderEmail`. (The old `parseAmazonEmail` name was renamed — internal API only, no users.)
- `apps/cron/pipeline.ts`: `parseEmail()` tries shipment then order.
- Fixtures: `tests/fixtures/amazon-auto-confirm-eucalan.html` (single-item) and `amazon-auto-confirm-peak-design.html` (multi-item).

---

## 2026-05-15 — ASIN/product-ID strong dedup key

**Context:** With auto-confirm and shipment-tracking both producing rows for the same order, item-name drift becomes a real risk. Haiku extracts a clean short name from the auto-confirm ("Capture Camera Clip V3"); the shipment parser pulls from `<img alt>` and can produce a much longer name with the brand duplicated ("Peak Design Peak Design Capture Camera Clip V3, Black with Plate, Holds DSLR…"). After normalization the names still diverge → no dedup match → duplicate row.

**Decision:** Add a third dedup key — the **strong key** `(orderId, productId)` where productId comes from `productUrl`:
- Amazon: ASIN matched from `amazon.com/(?:dp|gp/product|gp/aw/d|product)/([A-Z0-9]{10})` → `amzn:<ASIN>`.
- REI: numeric ID matched from `rei.com/(?:section/)?product/(\d+)` → `rei:<id>`.

Strong key is checked **first**. Falls back to the existing full key (orderId + brand + normalizedItemName + color + size) and content key (for blank-orderId historical rows) when no productId is extractable.

**Why:**
- ASIN/product-ID is a stable canonical identifier that survives parser differences. Item names drift; URLs don't.
- Namespaced prefix (`amzn:` vs `rei:`) prevents accidental cross-retailer collision.
- No schema change to the sheet — productId is derived on the fly from `productUrl`.

**How to apply:**
- `lib/productId.ts: extractProductId(url)` — pure function, returns `amzn:…` / `rei:…` / null.
- `lib/dedup.ts: makeStrongKey(input)` returns `orderId||productId` when both are present.
- `DedupIndex.strongKeys: Set<string>` — checked first in `dedupItems()`.
- `lib/sheets.ts: readDedupKeys()` and `apps/cron/pipeline.ts` pass `productUrl` through.

---

## 2026-05-15 — Detect Amazon returns and flip Status to `returned`

**Context:** Tom returned a Sigma 18-50mm lens (refund issued 2026-05-06). His sheet still showed the row as `active` because the cron never looked at `return@amazon.com` emails. The `returned` Status value existed but had no automatic source.

**Decision:** Add `return@amazon.com` to `KNOWN_SENDERS` (role `amazon-return`). New parser `lib/parsers/amazon-return.ts: parseAmazonReturnEmail(anthropic, html)` extracts `{orderId, items: [{itemName, productUrl}]}` via Haiku from refund / dropoff-confirmed / return-received emails. Pipeline dispatches return emails to a separate path that finds the matching row by `(orderId, productId)` (with name-token fallback) and calls `updateRowStatus(rowIndex, 'returned')`.

**Why:**
- Sheet status is the source of truth for "what do I actually own right now". A returned item silently staying `active` corrupts that.
- Same Haiku pattern as the order parser — small, predictable surface area.
- Idempotent: re-applying a return to an already-`returned` row is a no-op.

**Trade-off accepted:** if Amazon sends a "Return started" email but the user keeps the item, the row gets flipped to `returned` prematurely. Acceptable — user can revert via `/status` correction or sheet edit. The vast majority of return emails are post-decision (refund issued, dropoff confirmed) so the false-positive rate is low.

**How to apply:**
- `lib/sources.ts`: `KNOWN_SENDERS` includes `return@amazon.com`; `EXPECTED_SUBJECT_PATTERNS['amazon-return']` covers "Refund issued", "Dropoff confirmed", "Return received|requested|started|initiated", "Your refund".
- `apps/cron/pipeline.ts`: loop branches on `pickRole(from)`; return actions accumulate, then applied after row appends; uses `findRowForReturn()` helper (strong key + name-token fallback).
- `PipelineResult` gains `returnsApplied` + `returnsUnmatched` counters; digest surfaces them.

---

## 2026-05-15 — Daily Telegram digest is always audible

**Context:** When the cron ran and found nothing, `disable_notification=true` made the digest a silent message. Tom couldn't tell from his phone whether the cron had run at all — a 15-day gap with no purchases looked identical to a 15-day outage. ("Is this app actively scanning my email?")

**Decision:** Always send the daily digest audibly. The heartbeat matters more than the noise tax (2 pings/day at 6am + 6pm Mountain).

**Why:** silent-when-nothing-changed optimized for unread-count politeness at the cost of observability. Tom would rather know the cron ran than not be pinged. If it becomes too chatty, the next iteration is "audible on activity OR errors, silent only when nothing-changed-AND-it's-mid-week."

**How to apply:** `apps/cron/pipeline.ts` — `disable_notification: false` unconditionally.

---

## 2026-05-15 — `/scan` on-demand inbox scan from the bot

**Context:** Twice-daily scheduled cron means up to ~12 hours of lag between a purchase email arriving and the row appearing in the sheet. Tom wanted a way to force a scan now ("did this thing get picked up yet?") without SSHing into Railway or waiting for the next 6am/6pm run.

**Decision:** New bot command `/scan`. The bot calls `runPipeline()` directly — same code path as the cron — with telegram credentials intentionally omitted so the pipeline doesn't send its own digest. The bot returns a formatted summary as the chat reply.

**Why:**
- One pipeline implementation = one set of behaviors. Bot and cron stay in sync forever.
- Reuses bot's existing Anthropic + sheets clients via env vars (bot service has the same env as cron on Railway).
- No new Railway service needed; it's just a bot command.

**Trade-off accepted:** if `/scan` runs at the exact same moment as the scheduled cron, both might process the same unlabeled messages → potential duplicate rows. Mitigations: the Gmail label is applied at the end of each run (race window is the pipeline's runtime, ~5–60s), strong-key dedup catches same-ASIN-same-order, and twice-daily cron means the collision probability is tiny. Not worth a real lock for v1.

**How to apply:**
- `apps/bot/commands/parse.ts`: `'scan'` added to `CommandName`/`KNOWN`.
- `apps/bot/handlers.ts`: `handleScan()` calls `deps.runScan()`, formats `PipelineResult` as a Telegram-friendly summary, force-refreshes the inventory cache when items were added or returns applied.
- `apps/bot/index.ts`: wires `runScan = () => runPipeline({...env, telegramBotToken: undefined, telegramChatId: undefined})`.
- `/help` text lists `/scan`.

---

## 2026-05-15 — Trash-aware hourly cron + 7pm MT daily digest

**Context:** Twice-daily cron created a ~12-hour visibility window during which a user-deleted purchase email could be lost forever (Gmail's default search excludes Trash). Even when the user didn't delete anything, the up-to-12-hour latency between purchase and row appearing felt long.

**Decision:**
1. Gmail query gains `in:anywhere` so Trash + archive are both scanned.
2. Cron schedule moves from 2x/day to hourly (`0 * * * *` UTC on Railway).
3. New "Cron Log" sheet tab persists one row per run (auto-created on first write, auto-pruned to 30 days).
4. Telegram sending becomes conditional: immediate audible alert on any run with errors; a single audible daily summary at 19:00 Mountain time aggregated from the Cron Log; silent every other hour.
5. `apps/cron/pipeline.ts` is now side-effect-pure — it returns `PipelineResult` only. `apps/cron/index.ts` owns Cron Log writes and Telegram sends. This keeps `/scan` (which calls `runPipeline` directly from the bot) simple and free of pipeline-side notifications.

**Why:**
- Trash inclusion closes the "I deleted it before the cron ran" gap permanently. Strong-key dedup ensures safe re-scanning.
- Hourly cron tightens "appears in sheet" latency from ~12h to ~1h. Cost is negligible (Anthropic calls scale with parses, not runs; Railway compute is sub-cent).
- 1 audible message/day was Tom's stated comfort level. Errors are immediate because waiting 24h to learn the cron is broken defeats the heartbeat purpose.

**Trade-offs:** Spam folder is now also scanned as a free side effect of `in:anywhere` — accepted, strong-key dedup makes spurious matches harmless. If a run dies before writing its Cron Log row, that hour is invisible to the digest — accepted as an edge case.

**How to apply:**
- `apps/cron/pipeline.ts`: `buildQuery()` adds `in:anywhere`; runPipeline no longer sends Telegram.
- `apps/cron/index.ts`: appends Cron Log, prunes, decides send (errors / 7pm / silent).
- `apps/cron/digest.ts`: `formatDailySummary(rows, runCount)`, `formatErrorAlert(result)`, `shouldSendDailyDigestAt(now)`.
- `lib/sheets.ts`: `CronLogRow`, `appendCronLogRow`, `readCronLogToday`, `pruneCronLog`.
- `railway.cron.json`: `cronSchedule: "0 * * * *"`.
- `scripts/bootstrap-sheet.ts`: includes the Cron Log tab in fresh sheet bootstrap.
- One-time backfill: `npm run cron -- --reprocess --since=2026-04-30`.

---

## 2026-05-15 — Phase 3 Weather shipped: Pirate Weather + Nominatim

**Decision:** Outdoor agent's weather integration uses **Pirate Weather** for forecasts and **Nominatim** (OSM-backed) for geocoding. Implemented behind a single `WeatherClient` seam in `domains/outdoor/integrations/weather.ts` and exposed to the agent via the `get_forecast(location, days)` tool.

**Why:**
- **Pirate Weather over OpenWeatherMap.** Pirate Weather is a drop-in Dark Sky-compatible JSON API with a generous free tier (10k req/month) and no card-on-file. OpenWeatherMap's One Call 3.0 free tier requires a card. Cleaner onboarding for a single-user project.
- **Pirate Weather over NOAA.** NOAA is US-only; Tom's use cases include non-US trips (the original "surf trip to Australia" framing). Pirate Weather is global.
- **Nominatim for geocoding.** Free, no API key, no quota negotiation. Usage policy requires ≥1s between requests and a User-Agent — both honored. In-process cache makes the rate limit a non-issue for normal traffic.
- **Typed errors.** Surface as `{ ok: false, error: 'rate_limited' | 'api_error' | 'no_match' | 'bad_coords' }` so the agent can decide whether to retry, ask for clarification, or proceed without a forecast — instead of opaque 5xx noise.
- **Destination-local midnight anchoring.** "Tomorrow" is computed in the destination's local time zone, not the bot host's UTC. Matters for cross-time-zone planning.

**How to apply:**
- `PIRATE_WEATHER_API_KEY` is the only new env var. Add it to Railway for the bot service. Cron does not currently call weather.
- `domains/outdoor/integrations/weather.ts` is the single entry point. Don't bypass it.
- If a future provider swap is needed, keep the `WeatherClient` interface stable (`geocode` + `getForecast`) and the returned shapes (`Coords`, `DailyForecast`, `HourlyForecast`, `ForecastError`).
- Smoke harness: `npx tsx scripts/smoke-weather.ts <city>` hits both real APIs end-to-end.

**Acceptance test (2026-05-15):** Moab, UT 2-day query returned correct hot/dry desert forecast (highs 88–91°F, zero rain, 60°F overnight lows) and the agent selected sun-protection layers, hiking footwear, water capacity, and a warm sleeping bag from inventory.

**Supersedes:** the 2026-04-30 candidate list of "OpenWeatherMap or NOAA" (Decision A4-era).

---

## 2026-05-15 — Phase 5 in progress (foundation layer landed; cron+bot+search still to build)

**Status:** Spec + plan + Tasks 1-6 (foundation) complete. Tasks 7-20 pending.
**Spec:** `docs/superpowers/specs/2026-05-15-phase-5-camping-design.md`
**Plan:** `docs/superpowers/plans/2026-05-15-phase-5-camping.md`
**Resume:** `docs/SESSION_RESUME.md`

**What's locked from brainstorming:**
- **Tent-eligible filter:** index filters out RV-only sites, cabins, yurts. Picnic areas included with `useType='day-use'`.
- **Auto-booking:** Flavor A only (Telegram alert + deep link at exact release moment). No headless-browser checkout in v1.
- **Sheet authoritative for muted state.** "Camping Index" tab has writable Muted + Notes columns; cron preserves them across refreshes.
- **Separate Railway cron service** (`railway.camping.json` to be created in T12, per-minute schedule). Each tick self-gates by cadence.
- **Regions are both auto (parent unit) AND curated** (Front Range, Western Slope, San Juans, Sangres, Northern Mountains).
- **`/plan-trip <facility> <date>`** registers visits → bot fires 7-day nudge + release-moment alert. Season-opener nudges fire automatically for every non-muted facility 90 days before its calendar opens.
- **Storage:** Railway-volume JSON (`/data/camping-index.json`, `/data/camping-trips.json`, `/data/iOverlander.json`) — fast local cache; sheet is the visible mirror only for the Camping Index.

**Foundation files (T1-T6) landed:**
- `lib/reccgov/types.ts`, `regions.ts`, `client.ts`, `deep-link.ts`
- `lib/iOverlander/cache.ts`
- `lib/campingState.ts` (uses `proper-lockfile` for safe concurrent writes)
- Camping Index helpers appended to `lib/sheets.ts`

**Out of scope (deferred v1.5+):** Camping Trips sheet tab, auto-booking flavors B/C, non-CO seeds, walk-up alerts, USFS MVUM integration.

---

## 2026-05-15 — Phase 5: Free-camping search + reservation-release tracking

**Context:** Shipped Phase 5 of the outdoor companion. Spec: `docs/superpowers/specs/2026-05-15-phase-5-camping-design.md`. Combines on-demand free-camping search (Rec.gov + iOverlander) with proactive reservation-release tracking via a Railway-side index of all CO tent-eligible Rec.gov facilities.

**Key locked decisions:**
- **Tent-eligible only** — index filters out RV-only sites, cabins, yurts. Picnic areas included with useType='day-use'.
- **Auto-booking deferred:** Flavor A only (Telegram alert + deep link at the exact release moment). No headless-browser checkout in v1.
- **Sheet authoritative for muted state.** "Camping Index" tab has writable Muted + Notes columns; cron preserves them across refreshes.
- **Separate Railway cron service** (`railway.camping.json`, per-minute schedule). Each tick self-gates by cadence.
- **Regions are both auto (parent unit) AND curated** (Front Range, Western Slope, San Juans, Sangres, Northern Mountains).

**Out of scope (deferred v1.5+):** Camping Trips sheet tab, auto-booking flavors B/C, non-CO seeds, walk-up alerts, USFS MVUM integration.

---

## 2026-05-17 — REI in-store eReceipt ingestion + non-receipt labeling regression fix

**Context:** Tom ran `/scan` after a same-day in-store REI purchase; the eReceipt was already in his inbox but the cron reported `0 emails scanned`. Two distinct bugs in one symptom.

**Bug 1 — non-receipt labeling regression.** `apps/cron/pipeline.ts` was labeling any email that returned `'non-receipt'` from the parser with `inventory-processed`, then `-label:inventory-processed` in the query excluded it from all future scans. This directly violated the original locked decision (this file, line 162): *"If the parser determines an email isn't a receipt, skip silently. Don't apply the label so we can revisit later if needed."* The regression came from a Phase 1 implementation note (line 69) that was correct for its narrow context (Amazon order-confirms when the original architecture only ingested shipments) but became wrong once the architecture changed to parse both senders.

**Fix:** removed the `messagesToLabel.push(msgId)` in the non-receipt branch. New formats / new senders will now stay visible until they're successfully parsed. Trade-off: REI marketing emails from `rei@notices.rei.com` (rare; we already filter by sender allowlist) would be re-fetched every scan. Cost negligible since REI parsing is pure cheerio. For Amazon shipment-tracking sub-formats that fail (`Delivered:`, `Out for delivery:`), the Haiku order-confirm fallback will be re-invoked each scan — accept the small token cost as the price of not silently burying new formats.

**Bug 2 — no parser for REI in-store eReceipts.** The eReceipt subject `Your REI eReceipt - store purchase` and body don't match `parseReiEmail` (which keys on `A\d{8,}` online order IDs). Even with Bug 1 fixed, eReceipts would parse to nothing — they'd just stay un-labeled and never produce rows.

**Scope expansion (Tom, 2026-05-17):** REI in-store eReceipts are now in-scope for ingest. *"The heart of this app is an inventory tracker so we need to track all inventory regardless of purchase method."* This applies as a principle to any retailer that sends structured emails for in-store purchases (Amazon Whole Foods, etc., as those domains come online). Manual `/log` remains the fallback for purchases that produce no email at all (cash, gifts, marketplace).

**Parser:** new `parseReiReceiptEmail` in `lib/parsers/rei.ts`. Pure cheerio (consistent with online REI parser). Discriminator: `Transaction #:` + `Items purchased` markers in body (only appears on eReceipts, never on online-order REI emails — verified across fixtures). Dispatch in `apps/cron/pipeline.ts` tries online first, falls through to receipt parser — same pattern as Amazon shipment→order.

**Channel marking (Q1):** No new column, no Source-value change. Tom's call: don't surface online-vs-in-store in the data. `Source` stays `"REI"` for both. Order ID for store transactions is synthesized as `S{store#}-T{transaction#}` (e.g., `S18-T6158`) — uniquely identifies the transaction across stores/registers while staying visually distinguishable from online IDs (`A398129839` etc.) for human readers.

**Product ID for dedup:** the eReceipt body contains `Item #NNNNNN` (the 6-digit REI catalog ID, same value embedded in `rei.com/product/NNNNNN` URLs for online orders). Parser synthesizes `productUrl = https://www.rei.com/product/<itemId>` so the existing `extractProductId` returns `rei:NNNNNN`, and the standard strong key `(orderId, productId)` works the same as for online orders.

**Aggregation:** REI eReceipts emit one line per scan, so 4 Clif bars rung up individually produce 4 lines all sharing `Item #604787`. Parser aggregates by Item # and sums `quantity` — matches how online orders represent multi-quantity items.

**Color / size:** eReceipts don't expose either. Both fields land blank; dedup's `contentKey` cross-match (brand + normalized name) handles the resulting `/log`-vs-eReceipt collision case — verified by `tests/dedup.test.ts` "/log + REI eReceipt".

**Backlog cleanup:** `scripts/unlabel-emails.ts` removes `inventory-processed` from messages matching a Gmail query. Ran it against `from:rei@notices.rei.com subject:eReceipt` after fixing Bug 1 — 7 historical eReceipts unlabeled. The most recent (within `newer_than:30d`) will be picked up by the next `/scan`; older ones need `--reprocess --since=<date>` to ingest.

**Files:**
- `apps/cron/pipeline.ts` (Bug 1 fix + REI dispatch fallthrough)
- `lib/sources.ts` (added `/eReceipt/i` to `rei-order` subject patterns)
- `lib/parsers/rei.ts` (new `parseReiReceiptEmail`)
- `lib/gmail.ts` (new `removeLabel` helper)
- `scripts/unlabel-emails.ts` + `scripts/fetch-fixtures.ts` (added eReceipt query)
- `tests/parsers/rei-receipt.test.ts` (new, 10 tests)
- `tests/dedup.test.ts` (added `/log` + eReceipt scenario)
- `tests/sources.test.ts` (added eReceipt subject test)

---

## 2026-05-17 (later) — REI eReceipt itemName enrichment via Sonnet + web_search

**Context:** Immediately after shipping `parseReiReceiptEmail` (this file, prior 2026-05-17 entry), the 27 newly-ingested historical eReceipt rows in the sheet had terrible item names. The eReceipt's `<img alt>` text is the POS register abbreviation, not a real product name. Examples: `LoungerDLChairMesh`, `Trlmade Rain Pant`, `CompressiblePillow`, `ThermalMerinBL14Zp`, `CLIFBAR      CH/CH/2.4  /*OZ`. Downstream the classifier (Haiku 4.5) was getting garbage inputs and producing bad brand/domain/category guesses (e.g. a Smith ski helmet stored as "Charger MIPS" with no brand).

**Decision:** every in-store eReceipt item now goes through an enrichment step before classification. The enrichment takes the synthesized REI URL + the POS abbreviation + price paid and produces canonical `{brand, itemName, color, size}`.

**Failed approach we attempted first — direct REI scrape.** Tom's instinct was "if no downside, scrape REI." We tried using the existing `lib/parsers/product-lookup.ts:fetchProductInfo`, which already does a polite User-Agent HTTP fetch for `<title>` / `og:title` and runs Haiku on the result. **REI hard-blocks non-browser User-Agents via Cloudflare.** Verified empirically: `curl -A "Mozilla/5.0 (compatible; outdoor-inventory/1.0)"` returns HTTP 403; even a full browser-mimic UA + Accept headers gets dropped mid-handshake (curl exit code 92). The CLAUDE.md no-scrape rule turns out to have teeth, not just be aspirational. **Filed as fact, not future work:** any code path that needs REI product data must go through Anthropic's `web_search`, never direct `fetch()`.

**Chosen approach — Sonnet 4.6 + web_search.** `lib/parsers/rei-product-lookup.ts` exports `lookupReceiptItem(anthropic, item)`. Calls Sonnet 4.6 with a constrained system prompt and the `web_search_20260209` tool (max 2 searches). Sonnet runs queries like `site:rei.com <numeric-id>` and reads Google's snippets — these aren't blocked even when direct REI fetches are. Returns JSON `{brand, itemName, color, size}` or null. The `lib/parsers/rei-receipt-enrich.ts` orchestrator runs items 3 at a time concurrently and falls back to the raw parsed item if the lookup fails.

**Why Sonnet not Haiku.** Considered Haiku for cost. The task involves disambiguating a noisy SKU code against potentially-thousands of REI products via web search — Sonnet has measurably better tool-use chaining and named-entity recovery than Haiku for this. Cost was the right tradeoff: ~$0.05-0.10 per item × 5-15 items per eReceipt × maybe 2-4 eReceipts/month = ~$5/year. Negligible vs the value of clean data.

**Why not the existing `lookupProduct` (also Sonnet + web_search).** That function (in `lib/parsers/product-lookup.ts`) is shaped for the photo-capture flow: it takes a `brand + visionItemName`, returns up to 3 *candidate* product pages for the user to pick from. We needed a different shape: take a `productUrl + bad name + price`, return a single canonical record. Building a focused module keeps the prompts simple and the contracts tight.

**Channel marking remains the same.** Per the prior 2026-05-17 decision (Q1), eReceipts use `Source = "REI"` and `Order ID = S{store}-T{txn}`. Enrichment doesn't change those — it only touches `Item Name`, `Brand`, `Color`, `Size`. After enrichment the classifier runs again and updates `Domain`, `Category`, `Sub-Category`, `Type`, `Reasoning`.

**Backfill of historical rows.** `scripts/enrich-rows.ts` (npm script: `enrich-rows`) reads the sheet, filters rows where Order ID matches `^S\d+-T\d+$`, runs them through the same enrichment + classifier, batch-updates via the new `updateRowFields` helper in `lib/sheets.ts`. Default is dry-run; `--apply` writes. Ran once on 2026-05-17 against the 26 historical eReceipt rows — 26/26 enriched.

**Known imperfections accepted.** Consumables lose flavor detail (`CLIFBAR CH/CH/2.4 /*OZ` → "Energy Bar"; "Stinger Waffle" → "Waffle") because the item ID alone doesn't carry flavor info. Brand can occasionally be wrong (the Smith Charger MIPS came back with brand "Charger" — model name confused for manufacturer). Acceptable; the manual edit path exists.

**Files added/changed:**
- `lib/parsers/rei-receipt-enrich.ts` — orchestrator, concurrency=3, fallback-to-raw
- `lib/parsers/rei-product-lookup.ts` — Sonnet + web_search call, JSON contract
- `lib/sheets.ts` — `updateRowFields` batch helper
- `scripts/enrich-rows.ts` + `npm run enrich-rows`
- `apps/cron/pipeline.ts` — calls enrichment for eReceipt items in `parseEmail`
- `tests/parsers/rei-receipt-enrich.test.ts` — 6 tests (mocked lookup; tests delta-only updates, fallbacks, multi-item)

**CLAUDE.md updated** to reflect: scraping policy is "no direct REI/Amazon HTTP fetches — use web_search"; REI parser table row now mentions enrichment.

---

## 2026-05-17 (later) — Drop iOverlander; ship USFS + BLM + OSM as dispersed-camping sources

**Context:** Phase 5 planned to combine Rec.gov (developed reservable campgrounds) with iOverlander (community-sourced dispersed/wild camping) inside `searchFreeCampsites`. The plan assumed iOverlander had a public bulk-download CSV URL — that URL was marked "TBD" in the deploy doc and never resolved. When the time came to actually wire it up, research found:

- iOverlander's old `api.ioverlander.com/places/download.csv` returns **403**.
- Per-country CSV/JSON exports at `app.ioverlander.com/countries/places_by_country` now require **login + paid Unlimited subscription** and ship via email-delivered link.
- iOverlander ToS (2023) explicitly: *"personal, non-commercial use; no redistribution without written permission."* Caching the data on a Railway service to power a bot is a gray area at best.
- **FreeRoam** (popular alternative) shut down in 2024.
- **Campendium, The Dyrt, AllStays, Boondocking.org** — all closed/proprietary, no public APIs.

**Decision:** drop iOverlander entirely. Replace with three federal/community sources, all free, all public-domain or ODbL, no auth required:

1. **USFS Recreation Opportunities** — ArcGIS REST FeatureServer. Filter `markeractivity='Dispersed Camping'` + Western US bbox → ~600–800 records. Endpoint: `apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecreationAreaActivities_01/MapServer/0/query`. Public domain.
2. **BLM National Recreation Site Points** — ArcGIS REST MapServer Layer 4 ("Campsite - Primitive"). Endpoint: `gis.blm.gov/arcgis/rest/services/recreation/BLM_Natl_Recs_pts/MapServer/4/query`. Public domain.
3. **OpenStreetMap via Overpass** — `tourism=camp_site` + `camping=dispersed` nodes/ways. Endpoint: `overpass-api.de/api/interpreter` (POST). ODbL (attribution required, set agency='OSM community' on results so attribution shows in bot output).

**Why this is strictly better than iOverlander would have been:**
- Public-domain or ODbL licenses (vs iOverlander's personal-use-only ToS).
- No auth, no API keys, no subscription gates.
- Three sources cover overlapping/complementary terrain — USFS knows National Forests, BLM knows BLM land, OSM fills county/state-park/community-tagged gaps.
- Same `DispersedSpot` shape from all three; merged into one `/data/dispersed-snapshot.json` on the Railway volume.

**Schema changes:**
- `Facility.source` was `'recreation.gov' | 'iOverlander' | 'manual'`; renamed and narrowed to `'rec.gov' | 'manual'`. (The Camping Index tab only holds reservable facilities, which today all come from Rec.gov.)
- Dispersed sites get a new **"Dispersed Sites" sheet tab** (separate from Camping Index — no booking-window fields apply, schema is just Source/Name/Lat/Lng/Agency/Has Restrooms/Amenities/Description/Source URL/Last Verified).
- `CampsiteResult.source` widened to `'rec.gov' | 'USFS' | 'BLM' | 'OSM'` so the agent + Telegram output can attribute sources.

**Refresh cadence:** weekly Sunday 5:00 AM Mountain (one hour after index-refresh) via a new `shouldRunDispersedRefresh` tick in `apps/cron/camping/schedule.ts`. Per-source failures don't abort the others; partial failures surface a Telegram alert.

**Sources are gated by `DISPERSED_SOURCES` env var (added later same day).** Default is `USFS,BLM` (~793 Western-US rows). OSM is opt-in: the ~14,480 community-tagged points were noisy at the v1 scale and Tom wanted to keep them off the production sheet until we have a clearer use case for them. Set `DISPERSED_SOURCES=USFS,BLM,OSM` in Railway to re-enable.

**Files added:**
- `lib/dispersed/types.ts`, `lib/dispersed/cache.ts`, `lib/dispersed/usfs.ts`, `lib/dispersed/blm.ts`, `lib/dispersed/osm.ts`
- `apps/cron/camping/dispersed-refresh.ts`
- `lib/sheets.ts` — `mirrorDispersedSites`
- Tests: 38 new (USFS 11, BLM 10, OSM 12, dispersed-refresh 5)

**Files removed:**
- `lib/iOverlander/cache.ts`, `tests/lib/iOverlander/cache.test.ts`
- `IOVERLANDER_CACHE_PATH` env var (replaced by `DISPERSED_SNAPSHOT_PATH`)
- All iOverlander references from `freecamping.ts`, `tools.ts`, `agent.ts`

**One-time backfill on existing sheet rows:** ran `npm run backfill-camping-source` once after the rename to migrate 1,085 Camping Index rows from `recreation.gov` → `rec.gov`.

---

## 2026-05-17 (later) — Phase 4 trails: OSM Overpass (AllTrails ruled out)

**Context:** PLAN.md Task 4.1 said "First choice: AllTrails. Fallback: OSM Overpass." Investigated AllTrails reachability before writing code.

**Findings:**
- Anthropic's API supports remote MCP servers via `mcp_servers` + beta header `mcp-client-2025-11-20`. The plumbing works.
- AllTrails' MCP server is only surfaced inside claude.ai / ChatGPT consumer apps. No public endpoint URL, no OAuth client registration, no developer/partner program for `mcp_servers` use. Their support page explicitly states "no API keys or accounts required" — the auth is brokered by the consumer app, not by API consumers.
- AllTrails has no public REST API. Their web API is DataDome-protected against bots/scrapers.
- The well-known third-party `srinath1510/alltrails-mcp-server` was deprecated 2026-01-25 at AllTrails' request — they actively police re-wrappers.

**Decision:** Ship Phase 4 on OpenStreetMap via the Overpass API. Architecture is split across two infrastructure pieces:
1. **Nominatim** (OSM's geocoder) for `lookupTrail(name)` — its indexed full-text search handles OSM's idiosyncratic naming (e.g. "Manitou Incline" is tagged in OSM as just "The Incline" with `highway=steps`, not `highway=path`).
2. **Overpass** for `searchTrailsNearby(lat, lng, radius, activity?)` and for enriching Nominatim hits with full way geometry + tags.

**Why OSM is good enough:** Western US trail coverage is solid for named trails. We get name, geometry, length (Haversine-sum), surface (`surface` tag), and difficulty (`sac_scale` for hiking, `mtb:scale` for MTB). Activity classification derives from tags. The major gap vs AllTrails is elevation gain — OSM doesn't carry it. The agent now uses `web_search` to fill that in when the user asks specifically.

**Performance constraints learned (worth the effort to write down):**
- Global Overpass regex scans on `name` time out at 30s. We bound every query geographically — either an `around:` clause or a CONUS bbox fallback (24/-125/50/-66).
- Even with CONUS bbox + anchored prefix regex (`^Manitou Incline`), unindexed name scans time out. Nominatim's indexed search → Overpass-by-OSM-ID is the only reliable path for name lookups.
- `searchTrailsNearby` had to dedupe by name (OSM segments long trails into 5-10 named ways) and filter under-0.5km segments (urban path noise — campus shortcuts, sidewalk segments, bridge spans).

**Files added:**
- `domains/outdoor/integrations/trails.ts` — adapter + Nominatim + Overpass wiring
- `scripts/smoke-trails.ts` — `npm run smoke-trails` for live verification
- Tests: 23 (geometry helpers, mappers, query builders, Nominatim path, quality filters)

**Agent tools added (`domains/outdoor/tools.ts`):**
- `lookup_trail(name, near_location?, radius_km?)`
- `search_trails_nearby(location, radius_km?, activity?)`

System prompt now instructs the agent to combine `lookup_trail` + `get_forecast` + the inventory in context for "what gear for [trail]?" questions, and to fall back to `web_search` for elevation gain since OSM doesn't have it.

**If AllTrails ever exposes a partner API:** swap `lookupTrail` / `searchTrailsNearby` implementations — the `TrailInfo` shape stays the same and no caller needs to change.

---

## 2026-05-17 (later) — Phase 5.5 shipped: gear-maintenance nudges

**Context:** The 2026-05-01 entry locked Phase 5.5's plan. This entry locks the actual shipped behavior + the decisions made during implementation.

**Rule scope locked (DWR dropped):**
1. 🥾 Hiking boots — 3y resole-due, 5y replace-recommended
2. ⛺ Sleeping bags / quilts — 8y loft-check, 10y replace
3. 🧗 Climbing rope — 5y hard retire (UV degradation, even unused)
4. ⛷️ Skis / snowboard — 5y tune-recommended
5. 🪖 Helmets (bike / climbing / ski) — 5y replace (foam degrades)

**Why DWR shells got dropped:** would fire on every shell after 18 months and Tom doesn't actually re-DWR his shells in practice. Noise without action.

**Matcher design:** rules check **both `subCategory` AND `itemName`** because Tom's sheet uses high-level subcategories ("Footwear", "Sleep System", "Protection") rather than gear-specific ones. Without the dual check, only 0/93 candidate items would have fired against the real inventory. Excludes false positives (sleeping pads/pillows from the bag rule, ski boots from the hiking-boot rule, ski helmets from the ski rule).

**Schedule:** 1st of every month at 9 AM Mountain. Single-hour window prevents the hourly cron from re-sending. Piggybacks on the existing email-ingest cron service — no new Railway service.

**Ack model:** "Maintenance Acked" sheet tab. Appending a row silences an item for 12 months. `(itemId, recent ack)` filter, ack timestamp must be within last 365 days. Per-reason granularity rejected in favor of per-item (simpler UX). New `/ack-maintenance <6-char-id> [notes]` bot command writes the ack row programmatically; manual rows also accepted.

**Message format:** compact table (chosen over "friendly + explanatory" and "compact table" options). Cap at 10 items, oldest first, with item IDs at the bottom for ack reference.

**Files added:** `domains/outdoor/maintenance.ts`, `apps/cron/maintenance-nudge.ts`, `apps/cron/maintenance-schedule.ts`, `scripts/maintenance-dry.ts`. New `lib/sheets.ts` helpers: `readActiveMaintenanceAcks`, `appendMaintenanceAck`. 24 unit tests for rules + 8 for orchestrator + 4 for schedule + 5 for sheet helpers = 41 new tests.

**Acceptance run:** dry-run against the real 449-row sheet shows 0 findings now, which is correct — the 2018 Forbidden Road sleep bag (currently 7.8y) will fire in August 2026 when it crosses the 8y threshold. All rules correctly classify the 98 candidate outdoor-gear rows and produce no false positives.

---

## 2026-05-18 — Phase 6 shipped: read-only web dashboard

**Context:** Phase 6 in PLAN.md called for a Next.js read-only dashboard. Shipped 2026-05-18 at https://web-production-93cbd.up.railway.app.

**Architecture decisions:**

- **Next.js 14 App Router** (not Pages Router). Tom's first time using Next.js — App Router is the current default and what new docs / tutorials assume.
- **Root-level `app/` directory** (not `apps/web/`). Coexists with `apps/cron`, `apps/bot`. Lets the Next.js server components import `lib/sheets.ts` directly via relative paths without npm workspace plumbing. The alternative — a separate workspace with its own `package.json` — was rejected because it would duplicate the googleapis dep tree and complicate the cross-package imports.
- **Two tsconfigs.** `tsconfig.json` is the Next.js bundler-mode config (JSX, DOM lib, target `app/` + `middleware.ts`). `tsconfig.node.json` is the existing NodeNext config for cron/bot/scripts/tests. `npm run typecheck` runs both. `tsconfig.build.json` extends `tsconfig.node.json`. Without this split, the cron/bot code (which uses `.js`-suffixed NodeNext imports) and the Next.js code (which uses bundler resolution) can't coexist under one config.
- **Webpack extension alias** (`config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }`) in `next.config.js` lets the Next.js bundler resolve the NodeNext-style `.js` import suffixes used in `lib/sheets.ts` without requiring code rewrites.
- **HTTP Basic Auth via Edge middleware** (not URL token or Railway-private). Chosen over URL-secret because it's cleaner UX (browser caches the credentials for the session, never appears in URL bars). Uses `btoa` not `Buffer` since Edge runtime has no Node globals.
- **Server Components** fetch the sheet directly. No client-side API exposure of Google credentials. Each page sets `export const dynamic = 'force-dynamic'` so it re-fetches per request.

**Pages:**
- `/` — filterable items table, ~600 rows fit in client memory; client-side filter/sort. Search + Domain/Status/Type/Year dropdowns, sortable columns, status pill colors.
- `/spending` — 4 Recharts (total by year bar, by domain pie, top 10 categories horizontal bar, top 10 brands horizontal bar). Excludes returned + excluded rows from totals.
- `/needs-review` — Needs Review sheet-tab viewer; unresolved-only by default.

**Deploy:** new Railway service "Web" in Purchase-Inventory project. Config-as-code path: `/railway.web.json`. **Initial deploy failed** because Config-as-code path wasn't set (Railway used Nixpacks autodetect → ran the cron's `npm run build` instead of `npm run web:build`). Fixed by manually setting the config path in the dashboard. Also discovered a brittle `-p $PORT` flag in the start command — replaced with `npm run web:start` (Next.js reads `PORT` env directly), since `next start -p` errors out when `$PORT` evaluates to empty.

**Env vars added:** `WEB_USER`, `WEB_PASSWORD`. Auth falls open if either is unset (dev convenience).

**Out of scope:** editing (deferred per PLAN). Telegram-only workflow remains the primary write path.

---

## 2026-05-18 — Persistent URL cache for `seed-dispersed.ts` (post-incident)

**Context:** The 2026-05-17 USFS+BLM dispersed-pivot involved repeated iterations on `scripts/seed-dispersed.ts` (commits `a73d2b1` → `c74c166` plus another run at 2026-05-18 05:51 MT). Each run hit the URL resolver against ~793 sites via Sonnet 4.6 + `web_search`. The old in-script cache only retained snapshot entries whose URL was already on the agency domain — failed runs left no cache, so each subsequent iteration re-resolved everything from scratch. Estimated Anthropic spend over the 24h window: $40–90.

The `c74c166` "fail-fast on 8 consecutive failures" guard helped, but only kicks in on systemic failure (auth/billing) — it doesn't prevent paying again on partial-success retries.

**Decision:**

1. **Move the URL-resolution cache out of the snapshot file into its own persistent file** at `DISPERSED_URL_CACHE_PATH` (default `/data/dispersed-url-cache.json` in prod, `./local-data/dispersed-url-cache.json` in dev).
2. **Cache entry shape:** `{ "<source>|<id>": { url: string | null, resolvedAt: ISO, status: "canonical" | "tried-null" } }`. Canonical results kept forever; `tried-null` results honored for 30 days, then eligible for retry (handles transient API blips without permanent lockout).
3. **Atomic writes** (temp file + `rename`) and **incremental flushes** every 10 resolutions — a killed run preserves all progress.
4. **One-time bootstrap from the existing snapshot's canonical URLs** on first run after this change — so the ~700 URLs already resolved during the pivot don't re-pay.
5. **Confirm prompt at the start of `seed-dispersed`** with cost estimate: `"Will resolve N URLs (~$0.022/each, ~$X total). Continue? [y/N]"`. Bypass via `--yes` / `-y` flag for CI/automation.

**Cadence (locked):** Tom reruns `npm run seed-dispersed` every ~4 months to enrich net-new USFS/BLM additions. After the initial bootstrap, quarterly runs should resolve <50 net-new sites (≪ $1 typical).

**Why not auto-resolve inside the cron:**
- The weekly Sunday-5am dispersed-refresh stays free (HTTP-only fetches from USFS+BLM). Auto-resolving in cron would reintroduce continuous Anthropic spend.
- Couples a fast/free pipeline to a slow/expensive one — partial Sonnet failures would block the snapshot write.
- Failure modes are awkward to alert on inside a cron tick.
- Manual quarterly runs scale better for an at-most-50-new-sites/quarter signal.

**Files:**
- New: `lib/dispersed/url-cache.ts` (cache module — 4 exported functions, 1 constant)
- New: `tests/lib/dispersed/url-cache.test.ts` (11 tests: roundtrip, TTL boundaries, atomic write, malformed JSON)
- Rewritten: `scripts/seed-dispersed.ts` (bootstrap + confirm prompt + cache integration; fail-fast guard preserved)
- Updated: `.env.example` (new `DISPERSED_URL_CACHE_PATH` row)
- Updated: `CLAUDE.md` (new row + new DO NOT bullet)

**Forward-looking risk:** the hourly email-ingest CRON also calls Sonnet+web_search via `lib/parsers/rei-product-lookup.ts` on REI in-store eReceipts (added 2026-05-17, commit `fe34e54`). This is bounded by actual REI eReceipt volume (rare — maybe 1-2/week), but worth re-examining if a future cron tick spikes spend.

---

## 2026-05-18 — Phase 6.5 (calendar-aware trip prep) removed from scope

**Decision:** Drop Phase 6.5 entirely. The outdoor v1 build is done at Phase 6.

**Why:** Tom decided he doesn't want the proactive calendar-driven packing-list nudges. The Phase 2.5 `web_search` tool + the existing weather / trails / camping integrations already let the agent answer trip-prep questions on demand. Pushing unsolicited messages from a cron isn't a behavior he wants to add.

**Reverses:** the 2026-05-01 entry "Phase 3.5 added: Calendar-aware trip prep" (later renumbered to 6.5 and moved to end of build on 2026-05-15). That entry is preserved as history.

**How to apply:**
- `lib/calendar.ts`, `apps/cron/trip-prep.ts`, and the `calendar.readonly` OAuth scope expansion are no longer planned. Don't build them.
- The Phase 7+ gate now reads "Phase 6 in daily use ≥1 month" (was "Phase 6.5 in daily use ≥1 month").
- Phase 7+ deferred-features list still mentions "proactive features" generally — that bucket remains deferred per Discipline Rule 5 ("No proactive features in v1.5"); calendar nudges are a specific instance now removed permanently rather than postponed.

---

### 2026-05-19 — Item images: store locally vs hotlink retailer CDNs

Decision: download every image to the Railway `/data/images/` volume rather than hotlink retailer CDN URLs (m.media-amazon.com, images.rei.com, etc.).

**Why:** four of the five image sources — manual web upload, `/addgear` photo bytes, AI-resolved arbitrary-domain URLs, and the backfill phase — already need local storage. Hotlinking the remaining two (Amazon + REI parsed-email URLs) would require source-branching in `resolveImage`, expose the web UI to CORS/upstream-rotation issues, and break the read-after-write model that the detail panel depends on. A single storage path is simpler.

**Trade-off:** ~450MB of volume overhead for ~1500 items at ~300KB each, vs. zero-byte hotlink. Well within Railway's allocation. URL stability is no longer a concern once stored.

**How to apply:** all image resolution paths funnel through `lib/integrations/image-storage.ts:saveItemImage` (bytes in hand) or `downloadAndSave` (URL → local copy). The sheet's `Image` column stores the URL path the web service serves (`/images/<sha1>.<ext>`), not the source URL.

---

### 2026-05-19 — Item images: AI lookup runs on every cron ingest (not lazy / not batch)

Decision: when email extraction fails to produce an `imageUrl`, the cron immediately calls `lookupProductImageUrl` (Sonnet 4.6 + `web_search`) during the ingest, downloads the result, and writes it to the sheet on the same pass. No background queue, no lazy-on-view, no manual trigger.

**Why:** keeps the sheet visually complete without a separate backfill queue or a "loading" state in the UI. Tom values "everything has an image" over the cost minimization that on-demand would provide. The lookup only runs when email extraction failed (the minority case for Amazon + REI), so the unit cost is amortized over rows where it's the only option (in-store eReceipts, historical CSV imports).

**Trade-off:** ongoing Sonnet+`web_search` cost. Estimated ~$0.10–$1/day typical, ~$0.50–$2/day during heavy buying. Persistent cache at `/data/image-url-cache.json` (`canonical` forever, `tried-null` 30 days) amortizes repeats for re-classified rows.

**How to apply:** the resolution order in `lib/integrations/resolve-image.ts` is fixed — parsed `imageUrl` → cached lookup → fresh Sonnet call → download → fail-soft to empty string. Don't reorder; don't add a "skip lookup" flag without explicit user direction.

---

## 2026-05-19 — Phase 7 shipped: Photography domain (curriculum + grading + agent + web UI)

**Decision:** Photography is the second-domain end-to-end build (after Outdoor). Tom can now `/photo` to switch sticky mode, browse a 58-topic skill tree across 4 branches, get Claude-expanded lessons via `/learn`, get Claude-generated assignments via `/start`, submit photos for Opus 4.7 vision grading against a per-assignment rubric, and chat conversationally with the photography agent (weather, sun times, trails, gear advice). Read-only web UI at `/photography`.

**Why:** Phase 7 of `docs/PLAN.md`. Outdoor was in daily use; the multi-domain architecture worked as designed; photography was the next domain in queue per Tom's actual needs (Sony a6700 + Sigma 18-50 + Sony 70-350 + Epson ET-8550, all freshly purchased for learning).

**Scope shipped:**
- Skill tree: 58 topics in `domains/photography/tracks/{operating-camera,seeing,editing,printing}.ts`
- Curriculum runtime: `computeStatuses`, `pickNextTopic`, `generatePlan`, `applyProgressUpdate`
- 8 slash commands: `/skills`, `/track`, `/next`, `/active`, `/skip`, `/plan`, `/learn`, `/start`
- Claude expander (Sonnet 4.6 + OSM trail tools, time-agnostic assignments — see related decision below)
- EXIF (`exifr`) + Opus 4.7 vision grading
- Free-form photography agent (`web_search`, `get_forecast`, `lookup_trail`, `search_trails_nearby`, `get_sun_times`, `get_active_assignment`, `list_topics`, `get_topic_theory`)
- Web UI: `/photography` Skills grid, `/photography/[topicId]` detail, `/photography/assignments` history
- Onboarding: 3-question intake for fresh users (manual-mode confidence / starting topic preference / shooting cadence), driven entirely by agent system prompt
- Sheet tabs: `Photography Assignments`, `Photography Progress`

**How to apply:** photography work lives in `domains/photography/` and `apps/bot/commands/photography.ts`. Web UI in `app/photography/`. Sheet I/O in `lib/photographySheets.ts`. Photography is unique among domains: it has its own home page (Skills) rather than just filtering the Items table — the Photography link in DOMAINS sidebar routes to `/photography`, not `/?domain=photography`.

---

## 2026-05-19 — Skill tree: 4 branches × tiers (NOT 16 flat tracks)

**Decision:** The photography curriculum is organised as 4 branches (`operating-camera`, `seeing`, `editing`, `printing`), each with 3-4 tiers. The original spec called for 16 flat tracks (per-genre, per-gear, etc.).

**Why:** Tom's intuitive mental model is "the four things you actually do with photography" (operate the camera, see, edit, print). A flat list of 16 tracks dumped everything into one drawer. Tiers within a branch encode "tier 1 unlocks tier 2 unlocks tier 3" without needing every topic to declare full prereq chains, while still allowing per-topic prereq overrides (e.g., `manual-mode` explicitly requires `aperture-priority` + `shutter-priority`).

**Trade-off:** the spec's per-genre tracks (`genre-landscape`, `genre-wildlife`, etc.) became Tier-3 "recipes" inside the `seeing` branch — composable how-to scaffolds (`landscape-recipe`, `wildlife-bird-recipe`, etc.) instead of standalone curricula. Loses the granularity of per-genre branching but gains tighter coupling with composition / light / story fundamentals.

**How to apply:** `domains/photography/skillTree.ts` defines `BranchId = 'operating-camera' | 'seeing' | 'editing' | 'printing'` and `Tier = 1 | 2 | 3 | 4`. `validateSkillTree` enforces no cycles, no cross-branch prereqs, no tier violations. New topics go in the appropriate branch's file under `domains/photography/tracks/`.

---

## 2026-05-19 — Compressed Photo is the first-class submission flow (reversal of spec)

**Decision:** Photo submissions for grading default to Telegram's compressed Photo format (paperclip → Photo/Video, normal camera-roll share). The Document/File path still works (preserves EXIF) but isn't advertised. No nag in the grading reply about "send as Document next time".

**Why:** Spec section ([Phase 7 design doc] "EXIF gotchas") originally said photos must be sent as Document to preserve EXIF, with compressed Photo as the awkward fallback that prompts for manual settings. User testing (Tom: *"i would never send a photo as a document thats insane"*) made clear this was over-engineered. Real users share photos the normal way — from Camera Roll or Photos app. Telegram's compression strips EXIF but the rubric-based grading flow doesn't strictly need EXIF; Opus 4.7 vision can grade composition, light quality, focus, framing, and subject from the image alone. When the assignment specifically needs settings, the assignment text asks Tom to include them in the caption — that's the substitution.

**Trade-off:** without EXIF we can't auto-flag iPhone-shot-instead-of-a6700 cases for compressed Photos (only Documents). Acceptable — gear-mismatch is rare in practice and the rubric still catches obvious misses.

**How to apply:** `apps/bot/commands/photography.ts` no longer appends "send as Document next time" or "include settings in caption next time" footers. `formatStart` / `formatActive` say "Send a photo" not "Submit a photo as a Document". The agent's free-form-critique scope guardrail no longer mentions Documents either.

---

## 2026-05-19 — `did_not_pass` assignments stay "open" (resubmittable)

**Decision:** `getActiveAssignment` returns the most-recently-issued row with status `active`, `submitted`, OR `did_not_pass`. `passed` and `skipped` are terminal — they don't count as open.

**Why:** Per the Phase 7 spec, `did_not_pass` is meant to accept resubmits (retry counter bumps, photo re-grades). The original implementation filtered only `active|submitted`, so once a row was graded as failing, `/skip` and `/active` replied "Nothing active" and re-submitting a photo got "No active assignment" — making the spec's resubmit semantics unreachable.

**Why also degrade gracefully on multiple open rows:** In practice multiple open rows accumulate (interrupted /start, old test data, retry mid-flow). The original strict "throw if > 1 open" was right at /start time (don't create a second active assignment) but wrong at read time (broke every photography command until Tom manually cleaned the sheet). Reads now return the most-recent and log a warning; the strict invariant is enforced at /start.

**How to apply:** `lib/photographySheets.ts:getActiveAssignment` includes `did_not_pass`; returns most-recent on multiple; `console.warn` (not throw) on the multiple case. Tests in `tests/lib/photographySheets.test.ts` cover all three positive cases.

---

## 2026-05-19 — Assignment generation is location/time-agnostic (Claude expander rules)

**Decision:** When `/start` calls the Claude expander to generate assignment text + rubric, the expander MAY embed timeless CONDITIONS (e.g. "at golden hour") and timeless LOCATIONS (named trails / overlooks via `search_trails_nearby` and `lookup_trail` tools) but MUST NOT embed specific dates, current weather, or sun-times for specific dates. The agent's conversational interface handles "is Saturday clear?" / "what time is sunset tonight?" with its own tools — assignments stay reusable indefinitely.

**Why:** Tom may start an assignment and not shoot it for two weeks. Anything time-bound goes stale. Trail names + features don't expire. The separation: `/start` = "what skill to develop"; conversational agent = "when/where to shoot today".

**How to apply:** `domains/photography/expander.ts` only registers `search_trails_nearby` and `lookup_trail` as tools — NOT `get_forecast` or `get_sun_times`. The system prompt explicitly forbids dates/forecasts. The photography agent (`domains/photography/agent.ts`) has the full tool set for conversational queries.

---

## 2026-05-19 — `web_search` allowed-domains list: dedupe + screen for Anthropic-blocked hosts

**Decision:** `allowed_domains` arrays passed to Anthropic's `web_search` server tool must (a) contain no duplicates and (b) contain no hosts blocked by Anthropic's crawler. Both rules are hard requirements — violating either 400s the FIRST agent call, not just when search runs.

**Why:** Both surfaced as agent-breaking bugs during Phase 7 testing:
- A copy-paste typo left `redrivercatalog.com` listed twice in photography tools → "Domain list must not contain duplicates" 400 on every agent message
- `sony.com` and `reddit.com` are in Anthropic's blocked list (per their crawler robots.txt policy) → "The following domains are not accessible to our user agent" 400. Confirmed `youtube.com` likely also blocked (Google).

**How to apply:** `domains/photography/tools.ts` has a regression test in `tests/domains/photography/tools.test.ts` asserting `allowed_domains` is dup-free. Domain accessibility is harder to test statically (needs a live Anthropic call) — mitigation is to keep the list small + curated and remove any newly-blocked host as Anthropic's policy evolves. Outdoor's list (`domains/outdoor/tools.ts:WEB_SEARCH_ALLOWED_DOMAINS`) is the reference for the "this works" baseline.

---

## 2026-05-19 — `suncalc` is CommonJS — default-import + destructure required

**Decision:** Code that uses `suncalc` (`lib/integrations/sunTimes.ts`) must import via `import suncalc from 'suncalc'; const { getTimes } = suncalc;`, not the natural `import { getTimes } from 'suncalc'`.

**Why:** Vitest's Vite loader is permissive about CJS → ESM named imports and silently translates the named-import form. Node's strict ESM loader (which `tsx` uses for `npm run bot`) rejects it: `SyntaxError: The requested module 'suncalc' does not provide an export named 'getTimes'`. So the test suite passed while production was broken. The bot crashed on startup the first time we tried to run it locally.

**How to apply:** When adding any new CJS-only dependency, prefer default-import + destructure. If the existing test passes but the bot won't start, this is the first suspect. (Other CJS-only deps in the codebase already follow this pattern; the suncalc import was a one-off slip.)

---

### 2026-05-19 — Item images: `/addgear` is the single Telegram entry point

Decision: do NOT add a separate `/image <itemId>` command. The existing `/addgear` fuzzy-match branch grows new options when a duplicate is detected: **Attach** (matched row has no image) or **Replace** (matched row already has an image), in addition to the pre-existing "add anyway" (create new row) and `/cancel`.

**Why:** avoids fragmenting the Telegram-bot command surface; the fuzzy-match dedup machinery already exists in `lib/dedup.ts`; users don't need to memorize / copy item IDs from the web UI. Sending a photo of a thing already in inventory naturally lands at the dedup prompt — the right place to ask "is this the same item?".

**Trade-off:** there's no way via Telegram to attach an image to a specific row when the photo *doesn't* fuzzy-match it (e.g., to attach a stock photo to a row whose name has drifted). Web UI handles that case; sit-down backfill on the dashboard is the recommended path for those.

**How to apply:** dedup carries `image`, `orderId`, and `productUrl` on the matched-row record (`FuzzyMatch` interface in `lib/dedup.ts`). The `awaiting-dedup` state accepts `1`–`9` to attach/replace by candidate index; "add anyway" remains for force-creating a new row. `FuzzyCandidateRow` is now wider — any future caller of `fuzzyMatchExisting` must supply the new fields.

---

## 2026-05-19 — Split purchase Source from row Entry Method

**Decision:** `Source` and "how the row got into the sheet" are now two separate columns:

- **`Source`** keeps its original meaning — *where the item was purchased*. Type widens from the closed enum `'REI' | 'Amazon' | 'Other' | 'Image'` to plain `string` so `/addgear` can record actual retailers (Patagonia, Backcountry, Local Shop, etc.). `SOURCE_VALUES = ['REI', 'Amazon', 'Other']` is now just the canonical dropdown seed; `'Image'` is removed from it.
- **`EntryMethod`** (new column U, "Entry Method" header) records *how* the row got created: `email` / `photo` / `manual` / `import`.

Photo uploads (`/addgear`) now ask "Where did you buy it?" as a new `awaiting-source` step and stamp `entryMethod: 'photo'`. Email ingest stamps `entryMethod: 'email'`. `/log` stamps `manual`. The one-time historical CSV backfill is `import`.

**Why:** Pre-2026-05-19, `/addgear`-uploaded rows had `source: 'Image'`, which conflated *where you bought it* with *how you logged it*. That broke "spend by retailer" rollups (Image isn't a retailer) and made it impossible for the agent to reason about real provenance. Splitting them is a one-time schema cost; the rest of the system gets cleaner.

**How to apply:** Per-flow conventions:

- `/addgear` (`apps/bot/commands/addgear.ts`) — adds `awaiting-source` step between price and dedup. URL host pre-fills the guess (rei.com → REI, amazon.com → Amazon); user can override. Always sets `entryMethod: 'photo'`.
- Email ingest (`lib/router.ts`) — always `entryMethod: 'email'`.
- `/log` (`apps/bot/handlers.ts`) — always `entryMethod: 'manual'`.
- One-time backfill (`scripts/backfill-entry-method.ts`) — `npm run backfill-entry-method` (dry) / `-- --write`. Infers from orderId regex (`IMG-\d{8}-[a-f0-9]{6,}` → photo, `A\d{8,}` / `S\d+-T\d+` / `\d{3}-\d{7}-\d{7}` → email, else → import). Idempotent. Run on 2026-05-19 over 450 existing rows: 364 email / 4 photo / 82 import.
- Web UI items table: `Source` filter switched from `EnumFilter` to `TextFilter` (the values now come from data, not a fixed enum). `Entry Method` is a new addable column with its own enum filter.

If the source field is missing on a write path, audit it — the bot's `awaiting-source` step is the contract.

---

## 2026-05-19 — Photography topic page actions are in-app, not Telegram deep-links

**Decision:** `/photography/[topicId]` drives the full assignment flow itself via modals + `POST /api/photography/{learn,start,skip,submit}`. The original Phase 7 design used `tg://msg?text=/start%20topic-id` deep-links that opened Telegram. Those are gone.

**Why:** Telegram deep-links added friction (app switch, send message, switch back to read) and broke the affordance — clicking "Start assignment" should start the assignment, not compose a chat message. The web flow is now the first-class UX; Telegram remains available for power users.

**How to apply:** The Telegram bot's slash commands are unchanged — `/learn`, `/start`, `/skip`, and photo submission all still work in Telegram. The web routes are additive and use the same underlying primitives (`expandAssignment`, `expandLesson`, `gradePhoto`) the bot calls. Both surfaces write to the same Photography Assignments + Photography Progress sheet tabs, so state stays consistent regardless of which one Tom uses.

API contract:
- `POST /api/photography/learn` body `{ topicId }` → `{ lesson }`. Bumps `theoryLastReadAt`.
- `POST /api/photography/start` body `{ topicId }` → `{ assignmentId, topicId, topicName, assignmentText, rubric }`. 409 if an active assignment exists (the bot's one-active-at-a-time invariant holds).
- `POST /api/photography/skip` → `{ ok, skippedTopicId, skippedTopicName }`. 404 if no active assignment.
- `POST /api/photography/submit` multipart `image` + `caption` → `{ verdict, overallCritique, suggestedNextStep, perCriterion }`. JPEG / PNG / WebP / GIF only. ARW rejected (vision-unsupported). 20 MB cap.

Assignments are NOT pre-built — every `/start` calls Sonnet on the topic's `assignmentSeed` to generate fresh text + rubric personalized to current inventory. The "Generating assignment…" 3-6s spinner is expected behavior, not a bug. See the 2026-05-19 expander-rules entry above for the time-agnostic / location-aware contract.

If a future change extends the photography surface (e.g. `/next`, `/track`), prefer adding parallel web routes over adding more deep-links.

---

## 2026-05-24 — Weekly sender-drift audit cadence tightened; REI pickup subjects added

**Decision:** Two changes:

1. `shouldRunWeeklyAudit()` in `apps/cron/index.ts` now gates on `hour === 9` Mountain time, not `hour < 12`. Audit fires once per week (Sun 9am MT), not 12 times every Sunday morning.
2. `EXPECTED_SUBJECT_PATTERNS['rei-order']` in `lib/sources.ts` gained two patterns: `/Thanks for your order/i` and `/Your order is ready for pickup/i`. Both are real subject lines from `rei@notices.rei.com` for in-store-pickup confirmations.

**Why (gate):** The original 2026-05-02 audit spec was written when the cron ran twice daily (6am + 6pm) — gating on "Sunday morning" trivially meant the 6am tick. When the cron switched to hourly (`0 * * * *`), the gate became `Sunday AND hour < 12`, which was true on 12 separate ticks. Tom got 12 identical Telegram drift alerts on Sun 2026-05-24 before noticing. Tightening to a specific hour matches the original "once a week" intent without adding state.

**Why (subject patterns):** REI in-store-pickup orders generate two subject patterns that the existing allowlist didn't cover. They're legitimate REI mail from the allowlisted sender, so the audit kept flagging them as "subject drift." Adding the patterns silences the false positive without changing ingest behavior (these emails go through `parseReiEmail`, which keys off body content, not subject).

**How to apply:** When adding more REI/Amazon email surfaces in the future, add the subject pattern to `EXPECTED_SUBJECT_PATTERNS` even if the parser already handles the body — otherwise the drift audit will flag it every week.

---

## How to use this file

- **Append** new decisions with a date stamp and "Why" rationale
- **Don't overwrite** historical decisions — if something changes, add a new entry that references the prior decision
- When a future Claude session is unsure why something was chosen, this file is the answer
