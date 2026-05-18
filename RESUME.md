# RESUME — `seed-dispersed` URL catalog refresh

**Status:** paused 2026-05-18 ~09:55 MT mid-run. Laptop went to shop. Resume by running ONE command (see below).

---

## What we were doing

Finishing the dispersed-camping URL catalog after the 2026-05-17 pivot. Each USFS/BLM site gets a canonical agency URL resolved via Sonnet 4.6 + `web_search` and persisted to `local-data/dispersed-url-cache.json`.

Catalog of 793 sites. State on pause:

| Bucket | Count | Notes |
|---|---|---|
| **Canonical URLs cached** | 358 | Free on next run — applied from cache |
| **Cached as tried-null** (no agency page) | 214 | Free on next run — within 30-day TTL, skipped |
| **Unattempted** | 221 | Next run resolves these — ~$10 estimated |
| Total | 793 | |

## What we built this session (already committed)

Two commits on `main`:

- `9837c64` — Persistent URL cache + cost-confirm prompt for `scripts/seed-dispersed.ts`
- `4d51ba3` — Shuffle queue + raise fail-fast threshold + diagnostic smoke script

Tests: 60/60 dispersed tests pass. Typecheck clean. Branch is **2 commits ahead of `origin/main`** — push when convenient.

## Next session — single command

```bash
npm run seed-dispersed -- --yes
```

- ~10 min runtime
- ~$10 Anthropic spend (221 attempts × ~$0.045)
- Expect ~5-15% hit rate (remaining queue is BLM-heavy; many genuinely have no canonical agency page)
- After this finishes, all 793 sites will be cached (canonical or tried-null) → quarterly reruns become effectively free until 30-day TTL expires

## Diagnostic helper (if anything looks off)

```bash
npm run smoke-url-resolver
```

One-shot — ~$0.05. Dumps the full Sonnet response (web_search calls, tool results, final text) for one known-pass + one known-fail input. Use this to verify `web_search_20260209` and Sonnet are healthy before authorizing a full re-run.

## Background context

Why we built all this: the 2026-05-17 USFS+BLM dispersed pivot ran `seed-dispersed.ts` 4-5 times during iteration, each round re-resolving ~793 sites with no persistent cache. Estimated burn over 24h: $40-90. The cache + cost-confirm prompt + fail-fast guard make repeat runs near-free and prevent accidental re-spends.

Full write-up: **DECISIONS.md** entry "2026-05-18 — Persistent URL cache for `seed-dispersed.ts`".

## Files to keep in mind

- `lib/dispersed/url-cache.ts` — cache module
- `scripts/seed-dispersed.ts` — the main script (has confirm prompt, `--yes` bypass, queue shuffle, fail-fast at 30 consecutive nulls)
- `scripts/smoke-url-resolver.ts` — diagnostic dumper
- `local-data/dispersed-url-cache.json` — cache state (in `.gitignore`-ish — survives on this machine, doesn't push)
- `local-data/dispersed-snapshot.json` — merged snapshot (also local-only)

**Delete this RESUME.md** once the catalog is complete.
