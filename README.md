# purchase-inventory

Personal purchase-ingest + categorization platform that powers domain-specialist Claude agents. Outdoor first; other domains follow on the same architecture.

> Status: **Phase 0 — bootstrap.** See `docs/PLAN.md` for the full roadmap and `DECISIONS.md` for the locked design decisions. Read `CLAUDE.md` first if you're an AI assistant working on this repo.

## Quickstart (work-in-progress)

```bash
# 1. Install
npm install

# 2. Verify
npm run typecheck
npm test

# 3. Wire up Google OAuth (Phase 0, Task 0.3 — not yet implemented)
cp .env.example .env
# fill in GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET
npm run auth
# paste the printed refresh token into .env

# 4. Bootstrap the sheet schema (Phase 0, Task 0.4 — not yet implemented)
npm run bootstrap-sheet
```

## Layout

```
apps/        cron, bot (Phase 2+), web (Phase 6) — wires lib + domains together
lib/         pure infrastructure (Sheets, Gmail, parsers, Claude, Telegram, dedup, router)
domains/     one folder per domain; only outdoor is implemented in v1
scripts/     one-time tools: auth, bootstrap-sheet, import-history
tests/       vitest; fixtures/ holds saved real emails for parser tests
docs/        PLAN.md (roadmap), PRODUCT.md (vision)
```

Architectural rules: `lib/` knows nothing about domains; `domains/<x>/` cannot import from `domains/<y>/`; `apps/` wires them together.
