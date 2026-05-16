# Design — Trash-aware hourly cron + daily 7pm digest

**Date:** 2026-05-15
**Status:** approved (pending spec review)
**Author:** Tom + Claude (brainstorming)

---

## Problem

The current cron scans Gmail at 6am + 6pm Mountain time. Two related visibility gaps surface from this:

1. **Deleted-before-scan.** If a purchase email arrives and the user trashes it before the next scan, the bot never sees it. Gmail's default search excludes Trash. There's an up-to-12-hour window where this can happen.
2. **Coarse cadence.** Up to 12 hours can pass between a purchase email arriving and the row appearing in the sheet, even when the user doesn't delete anything.

We want a cron that (a) survives intentional deletion and (b) puts rows in the sheet within ~1 hour of email arrival, without spamming Telegram.

There's also a one-time hole: emails the user already deleted between 2026-04-30 and today were never seen.

## Decisions locked in brainstorming

| Question | Answer |
|---|---|
| What does "missed" mean? | A valid inventory email that the user trashed before the bot scanned the inbox. |
| Where should the scan look? | Trash too (in addition to Inbox + archive). Not Spam. |
| Where do trash-found items land? | Straight to All Purchases, same as inbox-found items. Strong-key dedup catches re-runs; user can `/excluded` any row they don't want. |
| Cron frequency going forward? | Hourly. |
| Telegram digest frequency? | 1× per day at 7pm Mountain — summary of the full day's activity. |
| Error notifications? | Immediate audible alert when a run has errors. Not rolled into the 7pm digest. |
| Push notifications (Pub/Sub)? | Skipped — overkill for a personal app. |
| Historical backfill? | One-time `--reprocess --since=2026-04-30` after deploy. |

## Architecture

### 1. Gmail query includes Trash

`apps/cron/pipeline.ts: buildQuery()` adds `in:anywhere` (Gmail's operator for "ignore folder filters — include archive, trash, spam"). We accept Spam coverage as a free side effect; it's not a goal, but the strong-key dedup means stray spam-classified receipts can't cause damage.

Existing labels behavior is preserved: `-label:inventory-processed` still filters out already-processed messages. A user who trashes an email *after* ingestion stays out of re-processing (the label is on the message wherever it lives).

### 2. Hourly schedule

`railway.cron.json: cronSchedule` changes from `"0 12,0 * * *"` to `"0 * * * *"` — every hour at :00 UTC.

The run itself is unchanged: same `runPipeline()` call, same options. Only the cadence changes.

### 3. New "Cron Log" sheet tab

A persistent record of each cron run so the 7pm digest can summarize the day's activity without re-querying Gmail.

**Schema (8 columns):**
| Run Timestamp (UTC) | Items Added | Items By Source | Items By Domain | Returns Applied | Messages Scanned | Errors Count | Duration (s) |

- `Run Timestamp` — ISO 8601 UTC string.
- `Items By Source` / `Items By Domain` — JSON-stringified objects, e.g. `{"Amazon":2,"REI":1}`.
- `Errors Count` — integer; the actual error details are in the immediate Telegram alert (not stored here, so PII like raw email subjects don't pile up in the sheet).
- `Duration (s)` — wall-clock duration of the run.

**Auto-prune:** at the end of each run, the pipeline deletes Cron Log rows older than 30 days. Keeps the tab bounded without manual maintenance.

**Bootstrap:** `appendCronLogRow()` checks whether the tab exists on its first call and creates it (with the schema above) if not. No separate migration step — Tom's existing sheet picks up the tab on the first hourly run after deploy. `scripts/bootstrap-sheet.ts` is also updated to include the tab so fresh deployments get it from the start.

### 4. Conditional digest logic

After each pipeline run, in `apps/cron/index.ts` (not in `pipeline.ts` — keep the pipeline pure):

```
if (result.errors.length > 0):
    sendAudible(formatErrorAlert(result))      # always, every run
elif (currentMountainHour() == 19):
    cronLogRows = readCronLogToday(sheets)
    sendAudible(formatDailySummary(cronLogRows + result))
# else: silent
```

`currentMountainHour()` uses `formatInTimeZone(new Date(), 'America/Denver', 'H')` so DST is handled correctly. The 19:00 MT firing window is whatever UTC hour maps to it (00:00 in DST, 01:00 in standard time).

**`formatDailySummary(rows)`** aggregates: total items, totals by source, total returns, total messages scanned, errored runs count, durations summary. Output is similar to today's digest but spans 24 runs instead of 1.

**`formatErrorAlert(result)`** is concise: which messages errored, what the error was, link/hint to logs.

### 5. One-time historical backfill

After the above is deployed and Railway has picked it up:

```
npm run cron -- --reprocess --since=2026-04-30
```

(Local with `.env`, or Railway shell.) This is the same command used to ingest the Eucalan earlier today — no special script. It walks every Amazon/REI/return email since 2026-04-30 (now including trash), dedups, appends new items, applies returns, and sends a one-shot digest at the end. Idempotent — running it again is a no-op.

## Components and responsibilities

| File | Change |
|---|---|
| `apps/cron/pipeline.ts` | `buildQuery()` adds `in:anywhere`. Pipeline returns `PipelineResult` as today; it no longer sends Telegram itself. |
| `apps/cron/index.ts` | After `runPipeline()`, decides whether to send (errors / 7pm / silent). Reads Cron Log when sending daily digest. |
| `lib/sheets.ts` | New `appendCronLogRow()`, `readCronLogToday(todayMt)`, `pruneCronLog(olderThanDays=30)`. |
| `scripts/bootstrap-sheet.ts` | Creates "Cron Log" tab with the schema. |
| `railway.cron.json` | Schedule → `"0 * * * *"`. |
| `apps/cron/audit.ts` | Unchanged — its existing Sunday-morning sender-drift check is orthogonal. |
| Tests | New unit tests for `formatDailySummary`, the conditional-send logic, and the Cron Log helpers. |

## Data flow

```
Gmail (in:anywhere, -label:inventory-processed, ...senders, after:...)
  → pipeline.ts run (parse, dedup, append, returns, label)
  → PipelineResult
  → sheets.appendCronLogRow(result)
  → sheets.pruneCronLog(30)
  → index.ts decides send:
       errors  →  formatErrorAlert  →  Telegram (audible)
       19 MT  →  readCronLogToday + format → Telegram (audible)
       else   →  no send
```

## Error handling

- **Pipeline-internal errors per message** stay scoped to that message (already true today): the run completes, `result.errors[]` lists them, the loop moves on.
- **Pipeline-fatal errors** (OAuth refresh failure, sheet unreachable) crash the run with non-zero exit. The Telegram alert is best-effort; if the bot can't send because the same outage blocks Telegram, Railway logs are the fallback.
- **Daily-digest read failure** (Cron Log unreadable at 7pm) falls back to formatting from the current run's `PipelineResult` alone, with a one-line note "(could not read day's log)".

## Testing

- Unit: `formatDailySummary()` with synthesized log rows (no-activity day, multi-source day, error-heavy day).
- Unit: `pruneCronLog()` with mixed-age fixture rows.
- Unit: hour-gate logic — `shouldSendDigestAtHour(19) === true`, others false. Mountain time, DST aware.
- Unit: `appendCronLogRow()` writes the right columns by header name (we use `buildHeaderMap` pattern, so reordering is safe).
- Integration: run the pipeline with a mocked Gmail returning trash + inbox messages; verify all are processed.
- Live smoke: after deploy, run `/scan` from Telegram, verify a Cron Log row appears.

## Risks / trade-offs

- **Spam folder is now scanned.** Strong-key dedup makes false-positives harmless, but a spam-classified receipt could land in the sheet. Acceptable — would have been a legit purchase anyway.
- **Hourly Anthropic load.** Empty inbox = no Haiku calls (parser short-circuits on `isShipmentEmail` / `isOrderConfirmEmail`). Worst case: ~$0.001 per parsed email; even 24 hourly runs is negligible.
- **24 cron runs/day on Railway.** Each run is ~10-30s. ~$0.001-0.005/day in container time. Trivial.
- **7pm digest depends on Cron Log accuracy.** If a run dies before writing its log row, that hour is invisible. Mitigation: write the log row at the end of every run, including ones with errors. Pruning happens after the write so log-write failures don't lose history.

## Out of scope

- Pub/Sub push notifications (Gmail `watch()` API + webhook). Considered, rejected as overkill for the goal.
- New status alerts beyond "errors present" (e.g., "haven't seen a purchase in 30 days"). Future enhancement.
- Auto-prune of Cron Log via a separate weekly job. Inlining the prune at the end of each run is sufficient and avoids a second cron service.

## Open questions

None — all design questions resolved in brainstorming.
