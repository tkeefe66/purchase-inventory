# CLAUDE.md — Inventory Platform

> Project-specific guidance for Claude Code. **Read this first** at the start of every session before touching code or making suggestions. This file overrides the global `~/.claude/CLAUDE.md` where they conflict.

---

## What this project is

A personal **purchase-ingest + categorization platform** that powers domain-specialist AI agents.

- **Ingest layer** reads order emails (REI + Amazon initially) from Tom's Gmail
- **Categorization layer** routes each item to a *domain* (Outdoor, Kitchen, Photography, etc.)
- **Per-domain agents** are Claude instances with domain-specific system prompts, tool registries, and external integrations
- **Storage** is a Google Sheet (source of truth for v1)
- **Interfaces** are Telegram (conversational) and a Next.js web UI (read-only dashboard)
- **Hosting** is Railway

The **outdoor agent** is positioned as Tom's broad outdoor *companion / guru* — knowledgeable across hiking, backpacking, mountain biking, climbing, skiing, paddling, surfing, trail running, and more — not just a gear advisor. It has Tom's full inventory as grounding plus tools (web_search, weather, AllTrails, free-camping) for current information.

The goal is *personal context multiplied by domain expertise* — a Claude that knows your gear, reads current weather, looks up real trails, and searches the web for current info is way better than a generic Claude that has none of that.

---

## THE GOLDEN RULE

> **Ship one domain end-to-end before starting another.**

The architecture is multi-domain from day 1. The delivery is single-domain at a time. **Outdoor is the only domain in v1.** Other domain folders exist as `README.md` stubs.

If you (Claude) are tempted to scaffold Kitchen, Photography, or any other domain before Outdoor is shipped and in daily use, **stop and remind Tom of this rule.** This discipline is in place because the failure mode for this kind of project is "great architecture, nothing shipped."

---

## Read these in order before working

1. **`docs/PLAN.md`** — the phased implementation roadmap. Authoritative for scope, ordering, file structure, and acceptance criteria. *Do not* deviate from PLAN.md without explicit approval.
2. **`DECISIONS.md`** — the Q&A log of every locked design decision and why. When something seems ambiguous, check here before asking Tom.
3. **`docs/PRODUCT.md`** — the original product vision (export of the source Google Doc). Useful background; superseded by `PLAN.md` where they differ.

---

## Architecture summary (canonical version in PLAN.md)

```
ledger/                     # current folder name: outdoor-inventory
├── apps/
│   ├── cron/               # Email-ingest pipeline, runs 6am + 6pm Mountain
│   ├── bot/                # Telegram listener + per-domain message router
│   └── web/                # Next.js read-only dashboard (Phase 6)
├── lib/                    # Cross-cutting infrastructure (knows nothing about domains)
│   ├── gmail.ts
│   ├── sheets.ts
│   ├── parsers/{rei,amazon}.ts    # Source-format parsers
│   ├── claude.ts                  # Anthropic SDK wrapper, prompt-cached
│   ├── telegram.ts
│   ├── dedup.ts
│   ├── router.ts                  # Domain router
│   └── types.ts
├── domains/                # Domain-specific code
│   ├── outdoor/            # ONLY domain implemented in v1
│   │   ├── classifier.ts
│   │   ├── inventory.ts
│   │   ├── agent.ts
│   │   └── integrations/{weather,alltrails,freecamping}.ts
│   ├── kitchen/            # README stub only until Phase 7+
│   ├── photography/        # README stub only until Phase 7+
│   └── other/              # Catchall for unrouted items
├── scripts/                # auth, bootstrap-sheet, import-history (one-time tools)
├── tests/                  # vitest; fixtures in tests/fixtures/
└── docs/                   # PLAN.md, PRODUCT.md
```

**Architectural rules:**
- `lib/` is pure infrastructure. It must not import from `domains/`.
- `domains/<name>/` knows about its own domain only. It can import from `lib/` but not from other domains.
- `apps/` wires `lib/` and `domains/` together.

---

## Locked decisions (full Q&A in DECISIONS.md)

| Topic | Decision |
|---|---|
| Tech stack | Node.js 20 + TypeScript 5, vitest, googleapis, cheerio, `@anthropic-ai/sdk`, Next.js, node-telegram-bot-api |
| Hosting | Railway, three services (cron, bot, web) sharing one repo |
| Cron | 6am + 6pm Mountain Time |
| Storage | Google Sheets (sheet ID in `PLAN.md`); no separate DB in v1 |
| Sheet schema | 18 columns; key ones: Source, Order ID, Status, Domain, Type, Product URL, Reasoning, Notes. **Code accesses columns by HEADER NAME (not position)** via `buildHeaderMap` in `lib/sheets.ts` — admin can reorder columns in Sheets UI without breaking ingestion. |
| Dedup key | `(Order ID, Item Name, Color, Size)` |
| Item lifecycle | `Status` column M: `active` (default), `retired` (still own, not in active rotation), `returned`, `lost`, `broken`, `sold`, `donated`, `excluded` (don't include in inventory analysis) |
| Year derivation | From `Date Purchased` in Mountain time |
| Price | Line-item price, post-discount, no shipping/tax |
| Email senders | REI: `rei@notices.rei.com`. Amazon: `auto-confirm@amazon.com` (order — "Ordered: …") AND `shipment-tracking@amazon.com` (shipment — "Shipped: …"). PLAN.md originally said `ship-confirm@amazon.com` — verified May 2026 against Tom's Gmail; correct sender is `shipment-tracking@amazon.com`. |
| REI parser | Pure cheerio; no LLM |
| Amazon parser | Tier 1 regex/cheerio → Tier 2 Claude Haiku 4.5 fallback → Tier 3 Needs Review |
| Brand extraction | Allowlist seeded from existing sheet's Brand column; LLM as backup |
| Color/Size for Amazon | Often blank; only filled when parser is confident |
| Categorization | Two-stage: domain router → in-domain category. Existing sheet vocabulary preferred; new categories created when needed. |
| Historical backfill | Tom provides CSV; one-time `scripts/import-history.ts` ingest |
| Failure mode | Sheet append must succeed before Gmail label is applied (so retries work) |
| Parse failures | Land in `Needs Review` tab; do not label the email; do not silently drop |
| Dry-run | `--dry-run` flag prints proposed actions without writing |
| Reprocess | `--reprocess --since=<date>` bypasses label filter |
| OAuth consent screen | Must be **published** (not Testing) — refresh tokens expire after 7 days otherwise |
| Notifications | Telegram for failure alerts and daily digest; optional v1.5 conversational interface |
| Agent model | Sonnet 4.6 for outdoor agent (better reasoning); Haiku 4.5 for Amazon parser fallback (cost) |
| Prompt caching | Always on (per global CLAUDE.md). System prompts + tool definitions cached. |
| Web UI v1 | Read-only dashboard; editing deferred |
| Multi-domain in v1 | NO — outdoor only. Other domain stubs are README.md only. |

---

## Tom (the user)

- Beginner-to-intermediate engineer. Explain decisions, flag tradeoffs, don't assume framework knowledge.
- Asks Claude to act as PM when product framing is needed — be honest about scope risk.
- Mountain time zone (`America/Denver`).
- Email: `tkeefe66@gmail.com`.
- Has Gmail, Google Calendar, Google Drive, AllTrails (newly added) connected to Claude.ai.

---

## Conventions

### Code

- TypeScript strict mode on
- Vitest for tests; fixtures in `tests/fixtures/`
- Default to no comments; only add when WHY is non-obvious (per global CLAUDE.md)
- Small focused files over large ones
- Domain code never imports across domains

### Git

- Commit per logical unit of work, not per phase
- Conventional-commit-ish prefixes: `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- Don't squash mid-build; squash at PR if needed (no PRs in v1 — solo dev)

### Testing

- TDD via `superpowers:test-driven-development` for parsers (textbook fit: HTML in, JSON out)
- Save real fixture emails as `.html` files in `tests/fixtures/`
- Mock googleapis and Telegram in unit tests
- Manual acceptance tests at end of each phase (5-question test for the agent, etc.)

### Secrets

- Never commit `.env`
- All secrets in Railway env vars in production
- `.env.example` documents every required var

---

## What to do / not do

### DO

- Read `PLAN.md` before suggesting any code change
- Use `superpowers:writing-plans` to expand a phase into bite-size TDD steps when execution time arrives
- Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to actually run the work
- Use `superpowers:test-driven-development` for parsers and classifiers
- Use `superpowers:verification-before-completion` before declaring a phase done
- Suggest committing after each task completes
- Update `DECISIONS.md` when a new decision gets locked in conversation
- Update `PLAN.md` when scope or sequencing changes (with Tom's approval)
- Cache Claude system prompts (per global CLAUDE.md guidance for Anthropic SDK apps)
- Surface the "open inputs needed from Tom" table from PLAN.md at session start when those inputs are about to block work

### DO NOT

- Do not start a second domain before Outdoor is shipped through Phase 6 (or Phase 5 if web UI is deferred)
- Do not log into or scrape REI.com or Amazon.com — even if it would make a feature easier
- Do not skip the 7-day soak test before Phase 2
- Do not add proactive features in v1 or v1.5 (no push notifications, no unsolicited suggestions)
- Do not write code that imports across domains (`domains/outdoor/` cannot import from `domains/kitchen/`)
- Do not add backwards-compatibility shims for code that doesn't have users yet — just change the code
- Do not write multi-paragraph docstrings or planning files unless asked
- Do not modify `CLAUDE.md`, `PLAN.md`, or `DECISIONS.md` without explicit confirmation

---

## External integrations available

| Service | Status | Used in |
|---|---|---|
| Gmail | OAuth, scopes `gmail.modify` + `spreadsheets` | Phase 0+ |
| Google Sheets | Same OAuth | Phase 0+ |
| Anthropic API (Claude) | API key | Phase 1 (Haiku for parsing), Phase 2+ (Sonnet for agents) |
| Telegram | Bot token via @BotFather | Phase 1 (digests), Phase 2+ (conversational) |
| **Anthropic web_search** (server tool) | Built-in to Anthropic API; no separate key | **Phase 2.5+** (outdoor agent grounds answers in current info) |
| OpenWeatherMap or NOAA | API key (free tier) | Phase 3 |
| AllTrails | MCP connected to Tom's Claude.ai account; **may not be reachable from Railway-hosted bot** — fallback to OSM Overpass API. Covers hiking, MTB, trail running. | Phase 4 |
| Recreation.gov | Free API key | Phase 5 |
| iOverlander, BLM, USFS | Investigation needed | Phase 5 |

**Explicitly NOT building:** Trailforks (AllTrails covers MTB), Surfline / Magic Seaweed (web_search covers surf-related queries), other activity-specific APIs.

---

## Useful skills for this project

- `superpowers:writing-plans` — expand a phase into bite-size TDD steps when execution begins
- `superpowers:executing-plans` — execute those steps with checkpoints
- `superpowers:subagent-driven-development` — alternative execution model: fresh subagent per task
- `superpowers:test-driven-development` — required for parsers and classifiers
- `superpowers:verification-before-completion` — before declaring any phase complete
- `superpowers:requesting-code-review` — before merging if/when we move to a PR workflow
- `claude-api` — auto-activates when working in `lib/claude.ts`; ensures prompt caching is correct
- `frontend-design:frontend-design` — for the Phase 6 web UI
- `update-config` — if we need to add Claude Code hooks, permissions, or env vars to settings.json
- `claude-md-management:revise-claude-md` — to keep this file fresh as the project evolves

---

## How to extend with a new domain (Phase 7+)

When the time comes (Outdoor must be in daily use first):

1. Create `domains/<name>/` with: `README.md`, `classifier.ts`, `inventory.ts`, `agent.ts`, `integrations/`
2. Implement `classifier.ts` — given an item, decide if it belongs to this domain + assign sub-category
3. Register the classifier in `lib/router.ts`
4. Implement `inventory.ts` — domain-specific query helpers (mostly copies of outdoor's, with domain filter applied)
5. Implement `agent.ts` — system prompt + tool registry tailored to the domain
6. Update `apps/bot/router.ts` to dispatch by intent (heuristic or Claude-based)
7. Reclassify any historical `Other` rows that should now belong to the new domain (one-off `npm run reclassify`)
8. Add a Phase entry to `PLAN.md` describing scope + acceptance for the new domain
9. Add a section to `DECISIONS.md` capturing any new decisions

---

## Maintenance

When code, decisions, or scope changes:

- **Code change** → just commit
- **New decision in conversation** → update `DECISIONS.md` (append, don't overwrite history)
- **Scope or phase change** → update `PLAN.md` after Tom confirms
- **Convention change** → update this file (`CLAUDE.md`) after Tom confirms
- **Skill or tool change** → update this file's "External integrations" or "Useful skills" sections

If anything in this file becomes false, fix it. A wrong CLAUDE.md is worse than no CLAUDE.md.
