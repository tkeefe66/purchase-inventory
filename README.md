# purchase-inventory

Personal purchase-ingest + categorization platform that powers domain-specialist Claude agents. Outdoor first; other domains follow on the same architecture.

> **Status (2026-05-18):** Phases 0-6 of the original outdoor scope are shipped. Email ingest, outdoor agent, weather, trails (OSM Overpass), camping (Rec.gov + USFS+BLM dispersed), monthly gear-maintenance nudges, and a read-only web dashboard are all live. Only Phase 6.5 (calendar-aware trip prep) remains in the original plan. See `docs/PLAN.md` for the full roadmap and `DECISIONS.md` for locked decisions. Read `CLAUDE.md` first if you're an AI assistant working on this repo.

**Live web dashboard:** https://web-production-93cbd.up.railway.app (HTTP Basic Auth)

## Quickstart

```bash
# 1. Install
npm install

# 2. Verify
npm run typecheck
npm test

# 3. Wire up Google OAuth (one-time)
cp .env.example .env
# fill in GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
npm run auth
# paste the printed refresh token into .env

# 4. Bootstrap the sheet schema (idempotent)
npm run bootstrap-sheet
```

## Running things locally

```bash
# Email-ingest cron (one-shot)
npm run cron          # live
npm run cron:dry      # dry-run

# Camping cron tick (release/nudge/refresh)
npm run camping-cron

# Telegram bot
npm run bot

# Web dashboard (Next.js)
npm run web:dev       # localhost:3000
npm run web:build     # production build
npm run web:start     # serve the prod build

# Inspection scripts
npm run maintenance-dry          # preview next monthly gear nudge
npm run smoke-trails             # OSM Overpass trail smoke test
npm run smoke-camping            # Rec.gov API smoke test
npm run seed-dispersed           # one-shot USFS+BLM dispersed-camping sync
```

## Layout

```
app/         Next.js App Router — / , /spending, /needs-review pages + middleware (Phase 6)
apps/cron/   email-ingest hourly cron
apps/bot/    Telegram bot (long-running)
apps/cron/camping/  per-minute camping cron (5 ticks)
lib/         pure infrastructure (Sheets, Gmail, parsers, Claude, Telegram, dedup, router, dispersed/, reccgov/)
domains/     domain-specific code; only outdoor is implemented in v1
scripts/     one-time tools (auth, bootstrap-sheet, import-history, enrich-rows, seed-dispersed, maintenance-dry, ...)
tests/       vitest; fixtures/ holds saved real emails for parser tests
docs/        PLAN.md (roadmap), PRODUCT.md (vision)
```

**Two tsconfigs:** `tsconfig.json` is the Next.js bundler config for `app/` + `middleware.ts`. `tsconfig.node.json` is the NodeNext config for the cron/bot/scripts/tests. `npm run typecheck` runs both.

**Architectural rules:** `lib/` knows nothing about domains; `domains/<x>/` cannot import from `domains/<y>/`; `apps/` (and `app/`) wires them together.
