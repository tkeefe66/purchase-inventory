# Deploying to Railway — Phase 1 (Cron Service)

This guide walks Tom through deploying the email-ingestion cron to Railway. ~15–20 minutes.

## Pre-flight check

Confirm locally first:

```bash
npm run build         # produces dist/
node dist/apps/cron/index.js --dry-run --max=1   # exits cleanly with empty result
```

Both should succeed.

## 1. Sign up / log in to Railway

1. Go to <https://railway.com> (note: `.com`, not `.app` — the domain changed).
2. Sign in with GitHub (this gives Railway access to your repos).
3. New users get a **trial credit** that should cover months of this project.

## 2. Create the project

1. Click **+ New Project** → **Deploy from GitHub repo**.
2. Authorize Railway to access `tkeefe66/purchase-inventory` if prompted.
3. Pick **`purchase-inventory`**.

Railway will start an initial deploy automatically. **It will likely fail** because env vars aren't set yet — that's expected. Skip past it.

## 3. Configure the service as a cron

Railway services default to "long-running web service" mode. We need a **cron**.

1. Click into the deployed service.
2. **Settings** tab → **Service** section → **Service Type**: change to **`Cron`**.
3. The cron schedule field appears. Set:
   ```
   0 12,0 * * *
   ```
   That's UTC. Translates to ~5–6am Mountain and ~5–6pm Mountain (drifts ±1 hour with daylight saving — acceptable for our use case; see DECISIONS.md if you want to shift).

4. **Settings** → **Source**:
   - Build command: leave blank (Railway reads `railway.json`)
   - Start command: leave blank (Railway reads `railway.json`)

5. **Settings** → **Watch Paths** (optional): add `apps/**` and `lib/**` so non-code changes to docs/tests don't trigger redeploys.

## 4. Add environment variables

In **Variables** tab, add each one. **Copy values from your local `.env`**:

| Variable | Source |
|---|---|
| `GOOGLE_CLIENT_ID` | from `.env` |
| `GOOGLE_CLIENT_SECRET` | from `.env` |
| `GOOGLE_REFRESH_TOKEN` | from `.env` |
| `GOOGLE_SHEET_ID` | from `.env` (or the canonical: `1lwCUsi5P74ekPYxgwjbOATGBLy-_Pqpg2j0Z4e4vdTQ`) |
| `GMAIL_USER` | `tkeefe66@gmail.com` |
| `PROCESSED_LABEL` | `inventory-processed` |
| `ANTHROPIC_API_KEY` | from `.env` |
| `TELEGRAM_BOT_TOKEN` | from `.env` |
| `TELEGRAM_CHAT_ID` | from `.env` |
| `INGEST_AFTER_DATE` | `2026-04-15` |
| `TZ` | `America/Denver` |

**Tip:** Railway has a "Raw Editor" — paste your entire `.env` file (minus comments and `.env.example` placeholders) and it auto-parses.

## 5. Trigger a fresh deploy

After saving env vars, click **Deploy** → **Redeploy**.

Railway runs `npm ci && npm run build` (~1 min), then waits for the cron schedule to fire. The first scheduled execution may be up to 12 hours away depending on UTC time.

## 6. Test the cron manually

In the service's **Deployments** tab → click the active deployment → there's usually a **"Run"** or **"Trigger now"** option for cron services. Use it to verify the cron runs end-to-end.

You should see in the logs:

```
Mode: LIVE
Building vocab from All Purchases...
✓ N categories, M brands
Reading existing dedup keys...
✓ X full keys, Y historical content keys
Query: from:(...) -label:inventory-processed after:2026/04/15
Found 0 messages to process    ← Or however many new emails
...
✓ Cron complete
```

And a Telegram digest in your chat.

## 7. Verify the schedule is right

In the service's **Settings** → **Cron**, confirm `0 12,0 * * *` is set. This means:
- Run at minute 0 of hour 12 UTC (5–6am MT)
- Run at minute 0 of hour 0 UTC (5–6pm MT)

For a different schedule, edit and redeploy.

## 8. Watch the next 7 days

Per `PLAN.md` Task 1.11 (the soak test), the cron must run unsupervised for **7 consecutive days** with:
- Zero parser crashes
- Zero unexpected duplicates
- Zero missed emails (you'd notice if a real REI/Amazon order didn't appear in the sheet within 12h)
- Telegram digest received each run

If the soak passes → Phase 1 is done; Phase 2 (outdoor agent) starts.
If it fails → fix and restart the 7-day clock.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails on Railway | Node version mismatch — `package.json` engines requires Node ≥20, Railway should auto-pick 20. If not, force via `NIXPACKS_NODE_VERSION=20` env var. |
| `OAuth refresh failed: invalid_grant` | The Google OAuth consent screen reverted to "Testing" (refresh tokens expire after 7 days). Re-publish, re-run `npm run auth` locally, paste the new refresh token into Railway env vars. |
| `Telegram sendMessage failed (HTTP 400)` | Usually a MarkdownV2 escaping issue. Pipeline uses plain text — should not happen. If it does, check the digest formatter. |
| `Sheet quota exceeded` | Unlikely at 2-runs-a-day scale. Sheets API has 60 reads/min and 60 writes/min per user — we're nowhere near that. |
| Telegram digest never arrives but no error | Bot token or chat ID env var missing/typo. Check Variables tab. |
| Cron never runs | Service Type wasn't switched to `Cron`. Default is "Web Service" which expects a port. |

## What lives where (production)

- **Code:** Railway runs `dist/apps/cron/index.js` from a fresh `npm ci && npm run build` on every redeploy.
- **Secrets:** Railway env vars (never in git).
- **Schedule:** `railway.json` declares `0 12,0 * * *` UTC; the Railway UI shows it.
- **Logs:** Railway service's **Logs** tab — searchable, retained 7 days on free tier.
- **Side effects:**
  - Reads from your Gmail (the cron's only "permission")
  - Writes to your Google Sheet
  - Sends Telegram messages

No data leaves Railway except the API calls above.
