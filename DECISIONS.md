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
- [ ] OpenWeatherMap API key OR decision to use NOAA (blocks Task 3.1; decide end of Phase 2)
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

## How to use this file

- **Append** new decisions with a date stamp and "Why" rationale
- **Don't overwrite** historical decisions — if something changes, add a new entry that references the prior decision
- When a future Claude session is unsure why something was chosen, this file is the answer
