# Inventory Platform — Implementation Plan

> **For agentic workers:** Roadmap-level plan. Each phase below has task-level granularity (files, acceptance criteria, dependencies). When executing a phase, generate the bite-size TDD steps for *that phase's tasks* at execution time using `superpowers:writing-plans`, then run via `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Build a personal purchase-ingest + categorization platform that powers domain-specialist AI agents (starting with Outdoor; Kitchen, Photography, etc. follow). The platform reads order emails, routes each item to a *domain*, and lets domain-specific agents — each with their own tools and external integrations — answer questions and assist with future purchases.

The **outdoor agent** is positioned as Tom's broad outdoor *companion / guru* — knowledgeable across hiking, backpacking, mountain biking, climbing, skiing, paddling, surfing, and other outdoor activities — not just a gear advisor. It is grounded in Tom's actual inventory (the moat: it knows what he owns) and augmented with external context tools (web search, weather, AllTrails, free-camping data) so it can reason about current conditions, current gear, and trip-specific needs.

**Architecture:** Three independent apps (`cron`, `bot`, `web`) sharing a `lib/` for cross-cutting infra (Sheets, Gmail, Claude, Telegram). Domain logic lives under `domains/<name>/` with its own categorizer rules, agent prompt, tools, and integrations. Adding a new domain = adding one folder. Google Sheets is the source of truth in v1 (no separate DB). Read-only with respect to retailers — only Gmail (read + label) and Sheets (read + append) are touched.

**Tech Stack:** Node.js 20 + TypeScript 5, vitest, googleapis SDK, cheerio, `@anthropic-ai/sdk` (Claude Haiku 4.5 for parser fallback, Sonnet 4.6 for agents), Next.js for web UI, node-telegram-bot-api for the bot. Hosted on Railway.

---

## THE GOLDEN RULE

> **Ship one domain end-to-end before starting another.**

The architecture is multi-domain from day 1. The *delivery* is single-domain at a time. Outdoor must be in daily use with at least one integration shipped before any second-domain work begins. Future Claude sessions: if you're tempted to scaffold Kitchen or Photography before Outdoor is shipped and used, **stop** — the user has explicitly committed to this discipline because the failure mode of this kind of project is "great architecture, nothing shipped."

---

## Phasing & shipping order

| Phase | Scope | Estimate | Ship gate |
|-------|-------|----------|-----------|
| **0** | Bootstrap: project scaffold, sheet schema migration, OAuth, historical CSV import | ~1 day | Sheet has cols K/L/M/N, "Needs Review" tab, refresh token in env, historical rows imported |
| **1** | Platform skeleton + outdoor inventory ingest | ~1 week | Cron runs 2×/day for 7 consecutive days with no parse errors, no duplicates, all outdoor purchases land with `Domain=Outdoor`, Telegram digest received |
| **2** | Outdoor agent v1 — broad outdoor companion (Telegram, no external integrations). Includes `/log` manual entry + `/lost`, `/sold`, `/donated`, `/retired`, `/broken` status commands. | ~2 weeks | Bot answers 5 gear/activity questions correctly + slash commands work |
| **2.5** | Add `web_search` tool to outdoor agent | ~1 day | Agent answers a "current conditions / current product / current price" question using fresh web info |
| **3** | Outdoor + Weather integration | ~3 days | Agent answers "what should I bring tomorrow for [trip]?" using current forecast |
| **3.5** | Calendar-aware trip prep (Google Calendar) | ~3 days | Cron checks calendar; sends Telegram packing-list nudge before upcoming outdoor events using inventory + weather |
| **4** | Outdoor + AllTrails (or fallback OSM) integration — covers hiking, mountain biking, trail running | ~1 week | Agent answers "what gear for [trail name]?" or "good MTB trails near X?" using trail data + inventory |
| **5** | Outdoor + Free-camping integration | ~1 week | Agent answers "where can I camp free near [location]?" using a real source |
| **5.5** | Gear age / maintenance nudges | ~1 day | Monthly cron surfaces items hitting age or maintenance thresholds via Telegram |
| **6** | Web UI (read-only dashboard, all domains) | ~1 week | Filterable by domain/category/brand/year/status; spend chart |
| **7+ (deferred)** | 2nd domain (Kitchen or Photography), more integrations, web UI editing | n/a | Out of scope until Phase 6 is in daily use for ≥1 month |

**Hard rule:** do not start Phase 2 until Phase 1 has run unsupervised for 7 days without intervention. An agent grounded in bad data is worse than no agent.

---

## Repository structure (target end-state)

```
ledger/                              # current name: outdoor-inventory; rename optional
├── CLAUDE.md                        # Project guidance for Claude Code sessions
├── DECISIONS.md                     # Q&A log of all locked decisions
├── README.md                        # Setup + usage (written end of Phase 0)
├── package.json
├── tsconfig.json
├── railway.json                     # Railway services config (cron + bot + web)
├── .env.example
├── .gitignore
├── docs/
│   ├── PLAN.md                      # This file
│   └── PRODUCT.md                   # Source product vision (export of source docx)
├── apps/
│   ├── cron/
│   │   ├── index.ts                 # Entry for 6am/6pm cron
│   │   └── pipeline.ts              # Orchestrates fetch → parse → route → dedupe → append → label
│   ├── bot/                         # Phase 2+
│   │   ├── index.ts                 # Telegram listener
│   │   ├── router.ts                # Route message to correct domain agent
│   │   └── handlers.ts              # Per-domain message handlers
│   └── web/                         # Phase 6
│       ├── pages/
│       └── components/
├── lib/                             # Cross-cutting infrastructure
│   ├── gmail.ts                     # Gmail client (auth, fetch, label)
│   ├── sheets.ts                    # Sheets client (read, append, schema bootstrap)
│   ├── parsers/                     # Source parsers (one per retailer)
│   │   ├── rei.ts
│   │   ├── amazon.ts
│   │   └── types.ts                 # ParsedOrder, ParsedItem
│   ├── claude.ts                    # Anthropic SDK wrapper, system-prompt caching
│   ├── telegram.ts                  # Send helper for digests + agent replies
│   ├── dedup.ts                     # Order-ID dedup logic
│   ├── router.ts                    # Domain router: which domain does this item belong to?
│   └── types.ts                     # Shared types: SheetRow, ItemStatus, Domain, etc.
├── domains/                         # Domain-specific code; one folder per domain
│   ├── outdoor/
│   │   ├── README.md                # What this domain covers, examples
│   │   ├── categories.ts            # Sub-categories + classification rules
│   │   ├── classifier.ts            # Decides "is this item outdoor?" + sub-category
│   │   ├── inventory.ts             # Domain-specific query helpers
│   │   ├── agent.ts                 # System prompt + tool registry
│   │   └── integrations/
│   │       ├── weather.ts           # Phase 3
│   │       ├── alltrails.ts         # Phase 4 (uses MCP if available, fallback to OSM)
│   │       └── freecamping.ts       # Phase 5
│   ├── kitchen/                     # Phase 7+ — stub only in earlier phases
│   │   └── README.md                # "Not implemented yet — see PLAN.md Phase 7"
│   ├── photography/                 # Phase 7+ — stub only
│   │   └── README.md
│   └── other/                       # Catchall for unrouted items
│       └── README.md
├── scripts/
│   ├── auth.ts                      # One-time OAuth refresh-token generation
│   ├── bootstrap-sheet.ts           # Adds cols K/L/M/N + "Needs Review" tab if missing
│   └── import-history.ts            # One-time historical CSV import
└── tests/
    ├── fixtures/
    │   ├── rei/                     # Saved real REI emails as .html
    │   └── amazon/                  # Saved real Amazon emails as .html
    ├── parsers/
    ├── domains/outdoor/
    └── router.test.ts
```

**Architectural discipline:**
- `lib/` knows nothing about domains. It's pure infrastructure.
- `domains/<name>/` knows about its own domain only. It can call `lib/` but not other domains.
- `apps/` wires `lib/` and `domains/` together.

---

## Sheet schema (Google Sheets)

**Sheet ID:** `1lwCUsi5P74ekPYxgwjbOATGBLy-_Pqpg2j0Z4e4vdTQ`
**Tabs:** `All Purchases` (existing), `Needs Review` (new in Phase 0)

### `All Purchases` columns

| Col | Header              | Notes |
|-----|---------------------|-------|
| A   | Year                | Derived from Date Purchased in **Mountain time** |
| B   | Date Purchased      | ISO 8601 date (YYYY-MM-DD) |
| C   | Category            | Sub-category within domain (e.g., "Camping Gear", "Cookware") — domain-specific vocabulary |
| D   | Sub-Category        | Finer grain (e.g., "Tent", "Sleeping Bag") |
| E   | Brand               | From classifier (allowlist seeded from existing sheet) |
| F   | Item Name           | Cleaned product name |
| G   | Color               | Often blank for Amazon |
| H   | Size                | Often blank for Amazon |
| I   | Qty                 | Integer |
| J   | Price (Paid)        | Line-item price, post-discount, no shipping/tax |
| K   | Source              | `REI`, `Amazon`, future retailers |
| L   | Order ID            | Dedup key |
| M   | Status              | `active` (default), `retired`, `returned`, `lost`, `broken`, `sold`, `donated`, `excluded`. `retired` = "still own it but not actively using." `excluded` = "don't include in inventory analysis." |
| **N** | **Domain**          | `Outdoor`, `Kitchen`, `Photography`, `Home`, `Tech`, `Wardrobe`, `Auto`, `Other`. Means *"which expert agent cares about this item for advisory purposes,"* not *"which activity context is this used in."* See DECISIONS.md (2026-05-01 entry on tightened Domain semantics). |
| **O** | **Product URL**     | Link to the retailer's product page, extracted from the email. Often blank for Amazon (links missing or volatile). Blank for historical CSV imports unless provided. Used by the admin (Tom) to click through and verify items; not used in dedup or by the agent. |
| **P** | **Type**            | `Gear`, `Consumable`, `Service`. **Gear** = durable owned items the domain agents reason about (clothing, equipment, electronics). **Consumable** = food, drink, supplements, sunscreen, batteries, anything used up. **Service** = memberships, subscriptions, repairs, experiences, race entries. Default agent inventory queries filter to `type=Gear`. |
| **Q** | **Reasoning**       | One-sentence explanation Haiku writes when it classifies an Amazon row, e.g. *"Camera tripod — durable photo-equipment item."* For REI rows, blank (direct mapping, no LLM judgement involved). Informational only; not used by the agent. Helps the admin understand why something landed where it did. |

**Dedup key:** `(Order ID, Item Name, Color, Size)` — same item bought again in a different order is allowed; same item in same order twice with same color/size is not. `Product URL`, `Type`, and `Reasoning` are *not* part of the dedup key.

### `Needs Review` columns

| Col | Header           | Notes |
|-----|------------------|-------|
| A   | Date Detected    | When the cron flagged it |
| B   | Source           | `REI` / `Amazon` |
| C   | Email Subject    | For human reference |
| D   | Gmail Message ID | So we can re-fetch the email |
| E   | Reason           | `parse-failed`, `low-confidence`, `unknown-domain`, `unknown-category` |
| F   | Raw Excerpt      | First 500 chars of email body |
| G   | Resolved         | Boolean — manually flipped to TRUE when handled |

---

## Environment variables

```bash
# Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_SHEET_ID=1lwCUsi5P74ekPYxgwjbOATGBLy-_Pqpg2j0Z4e4vdTQ
GMAIL_USER=tkeefe66@gmail.com
PROCESSED_LABEL=inventory-processed

# Anthropic (Phase 1+ for parser fallback, Phase 2+ for agents)
ANTHROPIC_API_KEY=

# Telegram (Phase 1 for digests, Phase 2+ for bot)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=                    # Tom's chat ID for digests/errors

# Outdoor integrations
OPENWEATHERMAP_API_KEY=              # Phase 3
ALLTRAILS_*=                         # Phase 4 — TBD based on MCP availability
RECREATIONGOV_API_KEY=               # Phase 5 (free; just a registration)

# App config
TZ=America/Denver                    # Mountain time for date derivations
DRY_RUN=false                        # Set true to print proposed actions without writing
```

---

## Phase 0: Bootstrap

**Outcome:** Sheet ready with platform schema, OAuth works, historical data imported, project builds and tests pass.

### Task 0.1: Project scaffold

**Files:** `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `vitest.config.ts`, `eslint.config.js`, `prettier.config.js`

**Acceptance:**
- `npm install` succeeds
- `npm test` passes (zero tests, exits 0)
- `npm run typecheck` passes
- `.gitignore` includes `node_modules/`, `.env`, `*.log`, `dist/`, `.DS_Store`

**Deps:**
- runtime: `googleapis`, `cheerio`, `dotenv`, `@anthropic-ai/sdk`, `node-telegram-bot-api`, `date-fns`, `date-fns-tz`
- dev: `typescript`, `@types/node`, `@types/node-telegram-bot-api`, `vitest`, `tsx`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`

### Task 0.2: Google Cloud Console setup (manual, Tom does this with Claude's guidance)

**Acceptance:**
- New GCP project created
- Gmail API + Sheets API enabled
- OAuth2 Desktop app credentials created
- Consent screen **published** (not Testing — refresh tokens expire after 7 days otherwise)
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` saved locally in `.env`

### Task 0.3: One-time auth script

**Files:** `scripts/auth.ts`

**What it does:** Runs OAuth flow locally, opens browser, captures auth code, exchanges for refresh token, prints it for the user to paste into Railway env.

**Scopes:**
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/spreadsheets`

**Acceptance:** `npm run auth` prints a refresh token that can list Gmail labels and read the sheet.

### Task 0.4: Sheet bootstrap script

**Files:** `scripts/bootstrap-sheet.ts`, `lib/sheets.ts` (initial version)

**What it does:**
1. Connects to the sheet
2. Reads header row of `All Purchases` tab
3. Adds missing column headers: `Source` (K), `Order ID` (L), `Status` (M), `Domain` (N), `Product URL` (O), `Type` (P), `Reasoning` (Q)
4. Applies a **data-validation dropdown** to column M (Status): `active`, `retired`, `returned`, `lost`, `broken`, `sold`, `donated`, `excluded`. Reject-on-invalid so manual edits can't typo a status.
5. Applies a **data-validation dropdown** to column N (Domain): `Outdoor`, `Other`, `Kitchen`, `Photography`, `Home`, `Tech`, `Wardrobe`, `Auto`. Future domains can be added by editing the script.
6. Applies a **data-validation dropdown** to column P (Type): `Gear`, `Consumable`, `Service`.
7. Adds a **conditional-formatting rule** that visually mutes (gray text / light fill) any row where `Status != active`, so the admin can see at a glance which rows the agent is actively "remembering."
8. Creates `Needs Review` tab if absent, with headers
9. Idempotent — re-running detects existing schema, validation, and formatting and is a no-op

**Acceptance:** Runs against the real sheet; second run prints "all schema present." Admin can open the sheet, click any cell in cols M/N/P and pick from a dropdown. Rows with `Status != active` are visually muted.

### Task 0.5: Sheet-to-sheet historical migration (Haiku-enriched)

**Files:** `scripts/migrate-to-master.ts`

**Replaces:** the original CSV-import design. Tom's existing spreadsheet already contains all historical data across three tabs (`REI All Purchases`, `Amazon Purchases`, `REI Summary`) — so we don't need a CSV. We migrate sheet-to-sheet into a new master `All Purchases` tab. Full rationale in `DECISIONS.md` (2026-05-01 entry: "Source sheet has 3 tabs, not 1").

**What it does:**
1. Reads existing `REI All Purchases` (cols A–K) and `Amazon Purchases` (cols A–G) tabs.
2. Builds a **seed vocabulary** from REI's distinct (Category, Sub-Category, Brand) values.
3. **REI rows → master tab** (direct mapping):
   - Date `Jan 26, 2022` → `2022-01-26` (ISO).
   - Price `$89.95` → `89.95` (numeric).
   - `Source = "REI"`, `Order ID = ""` (REI tab has no order IDs), `Status = "excluded" if REI col C "Exclude" = "Yes" else "active"`, `Domain = "Outdoor"`, `Product URL = ""`.
4. **Amazon rows → master tab** (Haiku-enriched):
   - Date `4/30/2026` → `2026-04-30`.
   - Price `$79.95` → `79.95`.
   - `Source = "Amazon"`, `Order ID` preserved from source, `Status = "active"`, `Product URL = ""`.
   - Sends item name + Amazon's existing Category to Claude Haiku 4.5 with the seed vocabulary in a prompt-cached system message; Haiku returns `{ domain, category, subCategory, brand, type, reasoning }`. Prefer REI vocabulary; allow new categories where nothing fits.
   - **Tightened Domain semantics**: `Outdoor` only for *durable* outdoor gear (clothing, equipment, electronics) AND outdoor-specific services (REI Membership). Consumables (food, drink, supplements, sunscreen — even outdoor-branded ones like energy gels) → `Other`. When in doubt → `Other`. Anti-pattern Haiku must avoid: classifying Gatorade as Outdoor "because outdoor people drink it."
   - **Type field**: `Gear` for durable items, `Consumable` for things used up, `Service` for memberships/subscriptions/repairs/race entries.
5. Writes the merged result to a new `All Purchases` tab (17 cols A–Q per the canonical schema). REI rows leave the `Reasoning` cell blank (no LLM judgement involved); Amazon rows include Haiku's one-sentence rationale.
6. **Dry-run by default** — prints sample classified rows + summary stats without writing. Re-run with `--apply` to write.
7. **Idempotent on `--apply`:** if `All Purchases` already exists with data, aborts with a clear message rather than appending duplicates. To re-migrate, delete `All Purchases` and re-run.

**Cost / time budget:** ~$0.50 of Anthropic spend; ~5 min wall time for 311 Amazon rows (concurrent batches of 10).

**Existing tabs (`REI All Purchases`, `Amazon Purchases`, `REI Summary`) are not modified** — left as a rollback safety net. Tom can rename/delete after the master tab is verified.

**Acceptance:**
- Dry-run prints sample converted rows (mix of REI + Amazon, mix of Gear/Consumable/Service, mix of Outdoor/Other) for human eyeballing of classification quality.
- After `--apply`: `All Purchases` tab exists with 17-col schema, ~393 data rows (82 REI + 311 Amazon), `Source` / `Domain` / `Status` / `Type` populated, Amazon rows have a `Reasoning` sentence.
- `npm run bootstrap-sheet` (Task 0.4) then runs cleanly against the new tab and applies validation + formatting + creates `Needs Review`.

---

## Phase 1: Platform skeleton + outdoor inventory ingest

**Outcome:** Cron runs 2×/day, ingests REI + Amazon emails, routes each item to a domain (Outdoor or Other in v1), writes to sheet, sends Telegram digest. Other domain folders exist as stubs.

### Task 1.1: Gmail client

**Files:** `lib/gmail.ts`

Same as previously specified — fetch unprocessed messages from `rei@notices.rei.com`, `auto-confirm@amazon.com`, `ship-confirm@amazon.com`; apply labels; ensure label exists.

### Task 1.2: REI parser

**Files:** `lib/parsers/rei.ts`, `lib/parsers/types.ts`

Pure cheerio parser. Returns `ParsedOrder` with line items. Returns null for non-receipt emails. Tested against ≥3 saved fixtures.

Each `ParsedItem` includes an optional `productUrl` field. The REI parser extracts the `<a href>` on the product name / image for each line item; if absent, the field is left blank. URL is the canonical retailer product page only (no tracking parameters stripped — leave as-is).

### Task 1.3: Amazon parser

**Files:** `lib/parsers/amazon.ts`, `lib/claude.ts`

Tier 1: regex/cheerio against shipment-confirmation (primary, more stable) and order-confirmation (price reconciliation) formats.
Tier 2: Claude Haiku 4.5 fallback with strict JSON schema if regex returns nothing or low confidence.
Tier 3: low-confidence Claude → return null + reason for Needs Review.

Each `ParsedItem` includes an optional `productUrl`. Amazon shipment emails *sometimes* include `amazon.com/gp/product/<ASIN>` style links per line item — extract when present, leave blank when not. Do not synthesize a URL from the ASIN if not seen in the email body. Haiku fallback also returns `productUrl` in its JSON schema as an optional field.

`claude.ts` uses prompt caching for the system prompt + JSON schema (per global CLAUDE.md, all Anthropic apps cache).

### Task 1.4: Domain router

**Files:** `lib/router.ts`, `domains/outdoor/classifier.ts`, `domains/other/classifier.ts`

**Two-stage classification:**
1. **Domain routing:** for each parsed item, ask each domain's classifier "is this yours?" → first match wins. If no domain matches, route to `other`.
2. **In-domain category:** matched domain's classifier returns `{ category, subCategory, brand, confidence }`.

**Outdoor classifier (Phase 1):**
- Keyword matching: jacket, pant, base layer, sock, helmet, boot, tent, stove, sleeping pad, headlamp, harness, climbing, ski, bike, pack, hydration, etc.
- Brand allowlist seeded from existing sheet's outdoor brands (Patagonia, Black Diamond, Arc'teryx, REI, Salomon, Smartwool, etc.) — match against name as second signal
- Returns confidence score
- Default in-domain category: `Review Needed`

**Other classifier:** catchall — anything that didn't match a real domain.

**Tests:** ~20 representative items from existing sheet, plus negative cases (kitchen items should NOT match outdoor).

### Task 1.5: Dedup

**Files:** `lib/dedup.ts`

Same as previously specified — key = `(Order ID, Item Name, Color, Size)`. Reads existing sheet rows once per run.

### Task 1.6: Sheets append

**Files:** `lib/sheets.ts` (extend)

Append rows to `All Purchases` with all 14 columns including `Domain` (col N). New rows always `Status=active`. Year derived from Date Purchased in Mountain time.

### Task 1.7: Pipeline orchestration

**Files:** `apps/cron/pipeline.ts`, `apps/cron/index.ts`

**Flow:**
1. Auth + bootstrap sheet
2. Fetch existing dedup keys
3. Fetch unprocessed Gmail messages
4. For each message:
   - Route to retailer parser by sender
   - If parse returns null → Needs Review entry, do not label
   - For each item: domain router → in-domain classifier → check dedup → append if new
   - Apply `inventory-processed` label only if all items appended successfully
5. Send Telegram digest
6. Exit 0 on success, non-zero on unrecoverable errors

**Flags:**
- `--dry-run`: skip writes; print proposed actions
- `--reprocess --since=<date>`: bypass label filter; reprocess emails since date

### Task 1.8: Telegram digest

**Files:** `lib/telegram.ts`

Send digest after each cron run: counts of new items per domain, errors, needs-review entries. Send error notifications on catastrophic failure.

### Task 1.9: Domain stubs

**Files:** `domains/kitchen/README.md`, `domains/photography/README.md`, `domains/other/README.md`

One-paragraph README each: "This domain is not implemented yet. See `docs/PLAN.md` Phase 7+. Items routed here today land in the `Other` domain in the sheet."

### Task 1.10: Railway deployment

**Files:** `railway.json`, `package.json` scripts

**Cron config:**
- Schedule: `0 6,18 * * *` in `America/Denver`
- Build: `npm install && npm run build`
- Start: `node dist/apps/cron/index.js`

**Acceptance:**
- Manual trigger from Railway UI works end-to-end
- Telegram digest received
- Sheet receives new rows with correct Domain
- 6am MT next-day cron runs automatically

### Task 1.11: Soak test (the ship gate)

**Acceptance:** 7 consecutive days of unattended cron runs with:
- Zero parser crashes
- Zero duplicate rows
- Zero Needs Review entries that should have parsed cleanly (manual verify)
- Telegram digest received each run

If this fails, fix and restart the 7-day clock.

---

## Phase 2: Outdoor agent v1 — broad outdoor companion (Telegram, no integrations)

**Outcome:** Tom DMs the bot, asks anything outdoor-related — gear questions, picking up new activities (mountain biking, surfing, climbing, etc.), trip planning, training, decisions about what to buy — and gets answers grounded in his actual inventory + Claude's broad outdoor knowledge. No external integrations yet (web search comes in Phase 2.5; weather/trails/free-camping in 3–5).

The agent is positioned as an **outdoor companion / guru**, not a gear-only advisor. Sonnet 4.6 already has deep outdoor knowledge (activities, technique, gear categories, trip planning, regional knowledge); the unique value is combining that with Tom's specific inventory.

### Task 2.1: Bot listener

**Files:** `apps/bot/index.ts`

Long-poll Telegram. Restrict to authorized chat IDs. Route incoming messages via `apps/bot/router.ts`.

### Task 2.2: Bot router

**Files:** `apps/bot/router.ts`

For now, every message goes to the outdoor domain handler. (Multi-domain routing is added when a 2nd domain ships — for now, simple pass-through with a TODO comment is fine.)

### Task 2.3: Outdoor inventory query layer

**Files:** `domains/outdoor/inventory.ts`, `tests/domains/outdoor/inventory.test.ts`

Query helpers:
- `getActiveItems(filters)` — filter by category, brand, year, status; defaults `status=active` and `domain=Outdoor`
- `getSpending(year?, category?)`
- `searchByText(query)` — fuzzy match on item name + brand
- `summarizeByCategory()`

Caches sheet read for the duration of one bot turn.

### Task 2.4: Outdoor agent

**Files:** `domains/outdoor/agent.ts`

**Draft system prompt** (will be tuned during implementation):

> You are Tom's personal outdoor companion — a knowledgeable guru across hiking, backpacking, mountain biking, climbing, skiing/snowboarding, paddling, surfing, trail running, and other outdoor activities. You have access to Tom's complete outdoor purchase history via tools, so you know what he already owns.
>
> Help him with: gear questions, trip planning, picking up new activities, training advice, where-to-go suggestions, technique pointers, and buying decisions. When he's considering a purchase, always check his inventory first to avoid recommending duplicates and to understand his existing setup.
>
> Be concise. Ask clarifying questions before recommending — don't assume. When you don't know something specific (current prices, recent product releases, current trail or surf conditions), say so. Never invent facts. In Phase 2 you have no real-time data; in later phases you'll get web_search, weather, trail, and camping tools.

**Tools (Phase 2):**
- `search_inventory(query, filters)`
- `get_spending(year, category)`
- `summarize_by_category()`
- `get_item_details(item_name)`
- `update_status(item_id, new_status)` — for "I lost my Jetboil" type messages

**Model:** Sonnet 4.6 (better reasoning than Haiku for this; Haiku stays in the parser fallback).

**Caching:** System prompt + tool definitions cached per global CLAUDE.md.

### Task 2.5: Slash commands (`/log` + status updates)

**Files:** `apps/bot/handlers.ts` (extend), `domains/outdoor/agent.ts` (extend)

**Commands to implement:**

- `/log <free-form text>` — manual purchase entry for buys that didn't come through Gmail (in-store cash, marketplace, gifts received). Bot extracts fields via Claude (item name, brand, price, source, date) and writes to sheet with `Domain=Outdoor` and `Status=active`. Asks for confirmation before writing. Example: `/log REI Co-op pickup, Black Diamond Couloir harness, $80 cash, today`.
- `/lost <item>` — fuzzy-match the item in inventory, set `Status=lost`. If multiple matches, bot asks which.
- `/sold <item>` — same pattern, `Status=sold`.
- `/donated <item>` — `Status=donated`.
- `/retired <item>` — `Status=retired` (still own it but not actively using).
- `/broken <item>` — `Status=broken`.

All commands write directly via the existing `update_status` tool / sheet append. Confirm to user via reply message ("Marked Patagonia R1 as retired").

**Tests:** Mock Sheets; verify each command resolves to the right action and the right Status value lands in the sheet.

### Task 2.6: Acceptance test (5 questions + slash commands)

Manually verify the bot answers correctly:
1. "Do I own a sleeping bag rated below 20°F?" *(inventory query)*
2. "How much have I spent on ski gear this year?" *(spending aggregate)*
3. "I'm thinking about a Patagonia R1 — do I have something similar?" *(inventory + reasoning)*
4. "I want to take up mountain biking — what should I think about as a beginner?" *(broad outdoor knowledge, no inventory match expected)*
5. "I'm planning a 5-day trip to Iceland in summer — packing thoughts?" *(trip planning + inventory, knowledge only since no integrations yet)*

Plus verify slash commands:
- `/log Black Diamond Couloir harness, $80, REI, today` → confirms + appends row
- `/retired Atom LT` → fuzzy-matches existing item, flips Status to `retired`
- `/lost <item that doesn't exist>` → bot says it can't find a match, asks for clarification

If any fail, debug + iterate before declaring Phase 2 done.

---

## Phase 2.5: Add `web_search` tool to outdoor agent

**Outcome:** Outdoor agent can ground its answers in current information (current product releases, current trail/surf/snow conditions, current pricing, recent reviews) instead of being limited to Sonnet 4.6's January 2026 training cutoff.

### Task 2.5.1: Add web_search to agent tool registry

**Files:** `domains/outdoor/agent.ts`, `lib/claude.ts` (if shared wrapper needs updating)

**What it does:**
- Adds Anthropic's built-in `web_search` server tool to the outdoor agent's tool list. (Server-side tool — Anthropic executes the search and returns results inline; no separate API key required, no client-side search code needed.)
- Updates the system prompt to mention the capability and when to use it ("when the user asks about current conditions, current prices, recent gear releases, or anything that may have changed since your training cutoff").

### Task 2.5.2: Acceptance test

Manually verify the bot answers correctly using fresh web data:
1. "What's the current swell forecast at Byron Bay this week?" *(surf info via web_search; no surf-specific integration needed)*
2. "What are the most-recommended beginner mountain bikes for trail riding right now?" *(current product info)*
3. "Is the John Muir Trail open right now? Any closures?" *(current condition info)*

If any fail, debug + iterate before declaring Phase 2.5 done.

**Note:** Phase 2.5 is a small, discrete deploy. Safe to ship the same week Phase 2 completes.

---

## Phase 3: Outdoor + Weather integration

**Outcome:** Agent answers "what should I bring tomorrow for [trip]?" using current forecast + inventory.

### Task 3.1: Weather client

**Files:** `domains/outdoor/integrations/weather.ts`

**Provider:** OpenWeatherMap free tier (or NOAA for US-only — free forever). Pirate Weather is also worth considering.

**Functions:**
- `getForecast(location, days): Forecast` — temp range, precipitation, wind
- `geocode(query): Coords` — for converting "Yosemite" to lat/long

### Task 3.2: New agent tool

Add `get_forecast(location, days)` to outdoor agent's tool registry. Update system prompt to mention the capability.

### Task 3.3: Acceptance test

"What should I bring for a 2-day trip in [real place] starting tomorrow?" → bot uses forecast, picks relevant items from inventory (insulation if cold, shell if rain, etc.), and recommends.

---

## Phase 3.5: Calendar-aware trip prep

**Outcome:** A new daily cron task reads Tom's Google Calendar, identifies upcoming outdoor events, and proactively sends a Telegram packing-list nudge that combines calendar + weather + inventory.

This is one of the features that uniquely justifies building the custom system over a Claude Project — a Project can't run scheduled background tasks against your calendar.

### Task 3.5.1: Calendar client

**Files:** `lib/calendar.ts`

**Responsibilities:**
- Authenticate using existing Google OAuth refresh token (Calendar API scope must be added — `https://www.googleapis.com/auth/calendar.readonly`)
- `getUpcomingEvents(days: number): CalendarEvent[]` — events within next N days
- `classifyAsOutdoor(event): boolean` — heuristic on title/description/location keywords (hike, ski, climb, trip, camping, MTB, Yosemite, etc.); fall back to Claude classification if heuristic is low-confidence

**Note:** OAuth scope expansion requires re-running `scripts/auth.ts` once to mint a new refresh token covering Calendar.

### Task 3.5.2: Trip-prep nudge job

**Files:** `apps/cron/trip-prep.ts` (new), wire into `apps/cron/index.ts`

**Behavior:**
- Runs once per day (separate cron entry from the email-ingest cron, or same cron with a flag)
- Fetches calendar events in next 5 days
- For each outdoor event: looks up forecast for the location, queries inventory for relevant gear by activity, asks Claude to compose a packing-list message
- Sends one Telegram message per event, with the event name + date + forecast summary + suggested items
- De-dupes — doesn't send the same nudge twice (track sent-events in a small state file or sheet tab)

### Task 3.5.3: Acceptance test

Add a real outdoor event to your calendar 2 days out (e.g., "Saturday hike at [location]") → next morning's cron sends a Telegram message with forecast + packing suggestions sourced from inventory. Re-running the cron same day does not re-send.

---

## Phase 4: Outdoor + AllTrails (or fallback)

**Outcome:** Agent answers trail-data questions across **hiking, mountain biking, and trail running** using AllTrails (or fallback) + inventory + weather.

**Scope decision:** Tom explicitly chose AllTrails as the single trail-data source for all trail-based activities. **Trailforks (MTB-specific) is explicitly NOT being built** — AllTrails covers MTB trails, and any gaps are filled by Phase 2.5 web_search.

### Task 4.1: Decide source

**First choice:** AllTrails — Tom has it connected to his Claude.ai account as an MCP. The Telegram bot runs on Railway with its own Anthropic API key, separate from Tom's Claude.ai session. **Critical question to verify at start of Phase 4: can the Railway-deployed bot use the AllTrails MCP, or is the MCP session-bound to Tom's claude.ai account?**

If AllTrails MCP is reachable from Railway → use it directly.

**Fallback (if MCP not reachable):** OpenStreetMap via Overpass API.
- Hiking trails: OSM `highway=path` + `sac_scale` tags
- Mountain biking: OSM `cycleway` / `mtb:scale` tags
- Trail running: same hiking trail set, filtered by surface/grade

OSM is free, well-maintained for popular areas, weaker for obscure ones. Acceptable v1 fallback.

### Task 4.2: Trail client

**Files:** `domains/outdoor/integrations/trails.ts` (name is activity-agnostic — `alltrails.ts` would be misleading if we end up on OSM)

**Functions:**
- `lookupTrail(name, activity?: 'hiking' | 'mtb' | 'running'): TrailInfo` — distance, elevation gain, surface, season, technical grade
- `searchNearby(coords, radius_km, activity?): TrailInfo[]`

### Task 4.3: New agent tools

Add `lookup_trail(name, activity?)` and `search_trails_nearby(location, radius_km, activity?)` to outdoor agent. Update system prompt to mention coverage of hiking, MTB, and trail running.

### Task 4.4: Acceptance tests

1. "What should I bring for [specific real hiking trail]?" → agent looks up the trail, combines with weather, picks gear from inventory.
2. "Find me a beginner-friendly MTB trail within 30 km of [location]." → returns real trails with difficulty info.
3. "Good trail-run options near [location] under 10km?" → returns appropriate options.

---

## Phase 5: Outdoor + Free camping

**Outcome:** Agent answers "where can I camp free near [location]?" using a real source.

### Task 5.1: Source selection

**Recommended primary:** Recreation.gov API (free, official, US federal land — covers a lot of free dispersed camping on USFS / BLM land).
**Secondary candidates:** iOverlander (community-sourced; data export available), The Dyrt (some free listings).
**To investigate:** USFS Motor Vehicle Use Maps for dispersed-camping areas.

### Task 5.2: Free-camping client

**Files:** `domains/outdoor/integrations/freecamping.ts`

**Functions:**
- `findFreeCampsites(coords, radius): Campsite[]`
- `getCampsiteDetails(id): CampsiteDetail`

### Task 5.3: New agent tool

Add `find_free_campsites(location, radius_km)` to outdoor agent.

### Task 5.4: Acceptance test

"Where can I camp free near [real location]?" → returns real, accurate campsite info with source attribution.

---

## Phase 5.5: Gear age / maintenance nudges

**Outcome:** A monthly cron scans the inventory and surfaces items hitting age or maintenance thresholds via Telegram. Helps Tom catch "your boots are 4 years old, time to think about resoling" or "you haven't logged a use of your shell in a while — still in rotation?" patterns.

This is a proactive feature that only makes sense in a custom build — Claude Projects can't run scheduled background analysis on your sheet.

### Task 5.5.1: Maintenance rules

**Files:** `domains/outdoor/maintenance.ts`

**Rules engine** — small set of category-based heuristics:
- Boots / hiking footwear: 3–5 years (resole/replace)
- Shells / waterproof outerwear: 18 months (DWR refresh suggestion)
- Sleeping bags: 8–10 years (loft check)
- Climbing rope: 5 years OR heavy use (retire)
- Skis: 80–100 days of use (tune; we don't track use, so go by age — 5 years)
- Helmets (climbing/bike/ski): 5 years (replace)
- Backpacks / soft gear: no age rule, only flag if `Status = retired` for >2 years (suggest sell/donate)

Rules return: `{ item, reason, suggestedAction }`.

### Task 5.5.2: Monthly nudge cron

**Files:** `apps/cron/maintenance-nudge.ts`, wire into Railway cron

**Behavior:**
- Runs once per month (cron: `0 9 1 * *` — 9am Mountain on the 1st of each month)
- Loads all `Status=active` items, applies rules
- Sends one consolidated Telegram message: "5 items might need attention this month: [list with reasons]"
- De-dupes — doesn't re-flag the same item every month if Tom has acknowledged it (tracks via a small "Maintenance Acked" sheet tab; Tom replies in chat or marks the row to dismiss)

### Task 5.5.3: Acceptance test

Run manually against current inventory (after enough historical data is loaded). Verify:
- Items meeting age thresholds get flagged with appropriate reasons
- Items recently flagged AND acknowledged don't re-appear next month
- Message is concise (≤10 items at a time; if more, prioritize by oldest)

---

## Phase 6: Web UI (read-only dashboard)

**Outcome:** Browser-accessible dashboard showing all purchases across all domains, filterable.

### Task 6.1: Next.js scaffold

**Files:** `apps/web/`, `next.config.js`

Separate Railway service. Server-side data fetch from Sheets via `lib/sheets.ts`.

### Task 6.2: Dashboard pages

- `/` — table of all active items, filter by domain/category/brand/year/source/status
- `/spending` — total spend chart by year, by domain, by category (Recharts)
- `/needs-review` — read-only view of Needs Review tab

### Task 6.3: Auth

Simple shared-secret URL param OR Railway-level basic auth. Single user, no SSO needed.

### Task 6.4: Deploy

Railway service for `apps/web/`, separate from cron and bot.

---

## Phase 7+ (deferred — DO NOT BUILD without explicit go-ahead)

### 7a. Second domain (Kitchen or Photography)

When ready, Tom picks the next domain. Pattern:
1. Create `domains/<name>/` with classifier, agent, integrations
2. Update `lib/router.ts` to include the new domain
3. Update `apps/bot/router.ts` to dispatch by domain
4. Reclassify any historical `Other` rows that should now belong to the new domain
5. Decide on integrations
6. Ship

The architecture makes this a 1-2 week effort per domain after the first.

### 7b. Other deferred features

- Returns email parsing (auto-flip Status to `returned`)
- Replacement nudges based on age + category
- Maintenance log (waterproofing, ski tunes)
- Web UI editing (mark items returned/lost)
- Photo buy-decision support (vision input from phone)
- Resale value tracker
- Lend/borrow tracking
- Wishlist + price-drop watch
- Other retailers (Patagonia, Backcountry, MEC, Black Diamond, etc.)

Each of these is its own planning effort once Phase 6 has been used for ≥1 month.

---

## Open inputs needed from Tom

These block specific tasks. Surface at session start so they don't surprise mid-build.

| Input | Blocks | Status |
|-------|--------|--------|
| Historical purchases CSV | Task 0.5 | ⏳ Tom to provide |
| 5–10 sample emails forwarded for fixtures | Tasks 1.2, 1.3 | ⏳ Tom to forward (REI single, REI multi, Amazon order, Amazon shipment, Amazon multi-ship) |
| Telegram bot token (via @BotFather) | Task 1.8 | ⏳ Tom to create |
| Telegram chat ID | Task 1.8 | ⏳ Send `/start` to bot |
| Anthropic API key | Tasks 1.3, 2.4 | ⏳ Tom to obtain |
| GCP project + OAuth credentials | Task 0.2 | ⏳ Tom + Claude walkthrough |
| OpenWeatherMap API key (or NOAA decision) | Task 3.1 | ⏳ End of Phase 2 |
| AllTrails MCP availability check | Task 4.1 | ⏳ Start of Phase 4 |
| Recreation.gov API key | Task 5.1 | ⏳ Start of Phase 5 |

---

## Out of scope (explicit non-goals)

- **Logging into REI.com or Amazon.com for any reason — never.**
- Modifying or canceling any purchase
- Multi-user support
- Real-time email processing (cron is fine)
- Separate database (Sheets is fine for current scale)
- Currency/FX (USD assumed)
- Mobile app (Telegram is the mobile interface)
- Credit-card / bank-feed ingest (interesting future, but adds compliance/security burden — not in v1)
- Multi-domain agent invocation in v1 (Phase 2 ships single-domain agent only)
- **Trailforks** — explicitly skipped; AllTrails covers MTB trails
- **Surfline / Magic Seaweed / surf-specific APIs** — explicitly skipped; web_search (Phase 2.5) handles surf-related queries
- **Strava integration** — explicitly skipped
- **Resale-value advisor** — explicitly skipped
- **Photo / receipt OCR** — explicitly skipped (manual `/log` covers in-store buys)
- **Weekly digest** — explicitly skipped (per-run Telegram digest from Phase 1 is sufficient)
- **Voice notes via Telegram** — out of scope; typed `/log` is fine
- **iMessage relay or any Apple Shortcuts integration** — out of scope
- **Multi-person mode** (partner's gear, lend/borrow tracking) — out of scope
- **Specialist sub-agents within outdoor** (separate trip-planner vs. gear-advisor) — out of scope; one agent with good tools is the right pattern
- **Tax categorization** — out of scope
- Activity-specific second integrations beyond AllTrails (e.g., separate climbing-route DBs, separate ski-resort APIs) — out of scope for v1; web_search fills the gap

---

## Discipline rules (enshrined)

These rules exist to prevent the "great architecture, nothing shipped" failure mode. Future Claude sessions: enforce these unless Tom explicitly overrides them in conversation.

1. **Ship one domain end-to-end before starting another.** Outdoor must be at Phase 6 (or Phase 5 if web UI is deferred) before any second-domain work begins.
2. **Architecture is multi-domain from day 1; delivery is not.** Don't write Kitchen code "just to have the structure ready" — the structure is `domains/kitchen/README.md` saying "not implemented." That's enough.
3. **Don't build Phase N+1 features while Phase N hasn't shipped.** No "while we're here" expansions.
4. **The 7-day soak test is non-negotiable.** Phase 1 must run unsupervised for 7 days before Phase 2 begins.
5. **No proactive features in v1.5.** The agent answers questions. It does not push notifications, suggest replacements, or volunteer opinions unprompted. That's v2.
6. **No retailer login. Ever.** Even if it would make a feature easier. The architectural constraint is the safety guarantee.
