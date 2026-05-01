# My Outdoor Inventory App — Product Plan for Claude Code

> **Status: historical / source-of-vision.** This is the original product brief Tom wrote before the platform reframe. Substantially superseded by [`PLAN.md`](./PLAN.md) and [`../DECISIONS.md`](../DECISIONS.md) — kept here as background. Where this file and PLAN.md differ, PLAN.md wins.
>
> Notable evolutions since this doc was written:
> - The system was reframed from a single-purpose "outdoor inventory app" to a **multi-domain purchase-ingest + categorization platform**, with Outdoor as the first domain. See `DECISIONS.md` → "The big reframe."
> - A **Telegram-fronted outdoor agent** (Sonnet 4.6, broad outdoor companion) was added as Phase 2+.
> - Schema gained columns M (`Status`), N (`Domain`), O (`Product URL`).
> - Cron schedule moved from 8am daily → 6am + 6pm Mountain.
> - Amazon parser gained a Claude Haiku 4.5 fallback tier; `Needs Review` tab added for low-confidence parses.
> - Several Phase 2 ideas from this doc were absorbed into the locked plan (web UI, status tracking, duplicate-gear awareness via the agent). The "REI dividend tracker" and "resale value tracker" were explicitly dropped.

---

## Overview

Build an automated purchase tracking system that monitors Gmail for REI and Amazon order confirmation emails, parses item data, and appends it to a Google Sheet. The system is hosted on Railway and runs on a schedule. It is a **read-only** system — it must **never** log into REI or Amazon to make, modify, or cancel any purchase under any circumstances.

## Core Principles & Safety Rules

- **READ ONLY**: This app only reads emails and writes to Google Sheets. It must never interact with REI.com or Amazon.com in any way — no browsing, no cart actions, no purchases, no account changes, no returns.
- **No stored passwords in code**: All credentials live in Railway environment variables only.
- **Idempotent**: Re-running the parser must never create duplicate rows. Every order must be tracked by a unique order ID.

## Tech Stack

- **Runtime**: Node.js (TypeScript preferred)
- **Hosting**: Railway
- **Email Source**: Gmail API (OAuth2 via Google Cloud Console)
- **Database/Output**: Google Sheets API (appends to existing sheet)
- **Scheduler**: Railway's built-in cron jobs (run daily at 8am)
- **Secrets Management**: Railway environment variables

## Environment Variables (set in Railway)

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_SHEET_ID=1lwCUsi5P74ekPYxgwjbOATGBLy-_Pqpg2j0Z4e4vdTQ
GMAIL_USER=tkeefe66@gmail.com
PROCESSED_LABEL=inventory-processed   # Gmail label applied after processing
```

## Google Cloud Setup (do this manually before coding)

1. Create a project in Google Cloud Console
2. Enable **Gmail API** and **Google Sheets API**
3. Create OAuth2 credentials (Desktop app type)
4. Run a one-time auth flow to get a **refresh token** with these scopes:
   - `https://www.googleapis.com/auth/gmail.modify` (to apply labels)
   - `https://www.googleapis.com/auth/spreadsheets`
5. Store client ID, client secret, and refresh token in Railway env vars

## Project Structure

```
/src
  index.ts              # Entry point, runs the pipeline
  gmail.ts              # Gmail API client — fetch & label emails
  parsers/
    rei.ts              # REI email parser
    amazon.ts           # Amazon email parser
  sheets.ts             # Google Sheets API client — append rows
  deduplication.ts      # Checks order IDs against existing sheet data
  types.ts              # Shared TypeScript interfaces
/scripts
  auth.ts               # One-time OAuth flow to generate refresh token
railway.json            # Railway cron config
package.json
tsconfig.json
.env.example
```

## Data Flow

```
Gmail Inbox
  → Fetch unprocessed REI + Amazon order emails
  → Parse each email → extract structured order data
  → Check Google Sheet for existing order ID (deduplication)
  → Append new rows to "All Purchases" sheet tab
  → Apply "inventory-processed" Gmail label to email
  → Log results
```

## Google Sheet Target

**Sheet ID:** `1lwCUsi5P74ekPYxgwjbOATGBLy-_Pqpg2j0Z4e4vdTQ`
**Tab:** All Purchases

**Column order** (must match exactly):

| Col | Header |
|-----|--------|
| A   | Year   |
| B   | Date Purchased |
| C   | Category |
| D   | Sub-Category |
| E   | Brand |
| F   | Item Name |
| G   | Color |
| H   | Size |
| I   | Qty |
| J   | Price (Paid) |
| K   | Source (new) |
| L   | Order ID (new, hidden dedup key) |

> **Note:** Add columns K (Source: "REI" or "Amazon") and L (Order ID) to the existing sheet. Order ID is the dedup key — never append a row if that order ID + item combo already exists in the sheet.

## Category & Sub-Category Auto-Assignment

Build a classification function that assigns Category and Sub-Category based on the item name. Use this as the starting logic (can be expanded):

### REI Category Rules

Apply the same category/sub-category logic already in the sheet:

- Keywords like "jacket", "pant", "base layer", "sock", "helmet", "boot", "tent", "stove", "sleeping pad", "headlamp", etc.
- Default to "Outdoor Gear" / "Accessories" if no match found
- Flag unclassified items in a "Review Needed" category for manual cleanup

### Amazon Category Rules

Amazon items are much broader, so use a tiered approach:

- First check Amazon's own category field from the email if available
- Then apply keyword matching on item name
- Categories to detect: Camping Gear, Hiking Gear, Ski/Snow Gear, Outdoor Clothing, Electronics, Home Goods, Books, Trail Snacks & Nutrition, Other
- Default: "Amazon / Uncategorized" — these can be manually recategorized in the sheet

## REI Email Parser (`parsers/rei.ts`)

**Trigger:** Emails from `@rei.com` with subject containing "Order Confirmation" or "Your REI order"

**Data to extract:**

- Order number (e.g. `A273845063`)
- Order date
- For each line item:
  - Product name
  - Brand (often in product name, needs splitting)
  - Color
  - Size
  - Quantity
  - Price paid (use sale/discounted price, not original)

**Notes:**

- REI emails are HTML — use a library like cheerio to parse
- Line items are in a `<table>` structure
- Watch for multi-item orders — each item becomes its own row in the sheet
- Some orders have multiple shipments — dedupe by order ID + item name combo

## Amazon Email Parser (`parsers/amazon.ts`)

**Trigger:** Emails from `@amazon.com` with subject containing "Your Amazon.com order" or "Order Confirmation"

**Data to extract:**

- Order number (e.g. `112-3456789-0123456`)
- Order date
- For each line item:
  - Product name
  - Brand (extract from product name if possible)
  - Quantity
  - Price paid
  - Color/Size (extract from item name string if present, e.g. "- Black / Large")

**Notes:**

- Amazon emails vary in format — handle both the older table-based format and the newer card-based format
- Digital orders (Kindle, Prime Video, etc.) can be skipped unless item name suggests outdoor relevance
- If an order contains 10+ items it is likely a household order — still parse all items, just let the category classifier sort them

## Deduplication (`deduplication.ts`)

```typescript
// On each run:
// 1. Fetch all existing Order IDs from column L of the sheet
// 2. For each parsed item, generate a key: `${orderId}::${itemName}`
// 3. Skip if key already exists in sheet
// 4. Append if new
```

This ensures the daily cron job can safely re-run without creating duplicates.

## Gmail Labeling

After successfully processing an email:

- Create a Gmail label called `inventory-processed` if it doesn't exist
- Apply it to the processed email
- On future runs, skip any email that already has this label

Query to find unprocessed emails:

```
from:(order@rei.com OR ship-confirm@amazon.com OR auto-confirm@amazon.com)
-label:inventory-processed
subject:(order confirmation OR your order)
```

## Error Handling & Logging

- If an email fails to parse, log the email subject + date and skip it (don't apply the label)
- If Sheets API fails, don't apply the label either (so it retries next run)
- Log a summary at the end of each run:

  > Run complete: 3 new REI items added, 7 new Amazon items added, 2 emails skipped (parse error)

- Store logs in Railway's built-in logging — no external logging service needed for v1

## Railway Cron Configuration (`railway.json`)

```json
{
  "deploy": {
    "cronSchedule": "0 8 * * *"
  }
}
```

Runs daily at 8am. Can be manually triggered in Railway dashboard for testing.

## Package Dependencies

```json
{
  "dependencies": {
    "googleapis": "^140.0.0",
    "cheerio": "^1.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "ts-node": "^10.0.0"
  }
}
```

## Phase 2 Ideas (not in v1)

- **Web UI**: Simple read-only dashboard (Next.js on Railway) showing your gear inventory with filters by category, year, brand
- **"Still Own" tracking**: Add a boolean column to mark items as sold/donated/lost — build toward a true gear inventory vs. purchase history
- **Gear value tracker**: Estimated current resale value based on age and category
- **REI dividend tracker**: Parse REI member reward emails and track annual dividend
- **Duplicate gear alerts**: Flag when a new purchase is very similar to something already in the inventory

## What Claude Code Should Build First (v1 Checklist)

- Project scaffold with TypeScript + dependencies
- One-time OAuth script to generate refresh token (`scripts/auth.ts`)
- Gmail client with label management
- REI email parser
- Amazon email parser
- Category/sub-category classifier function
- Google Sheets append client with deduplication
- Main pipeline (`index.ts`) tying it all together
- Railway cron config
- `.env.example` with all required variables documented
- README with setup instructions (Google Cloud setup, Railway deploy steps)

---

That's the full plan. A few things to flag when you hand this to Claude Code:

1. **The one-time OAuth flow** needs to be run locally first to generate your refresh token — Claude Code can build the script but you'll need to run it on your machine before deploying to Railway.
2. **Gmail label scoping** — make sure the OAuth scope includes `gmail.modify` not just `gmail.readonly`, since you need to apply labels.
3. **The existing sheet already has data in it** — tell Claude Code the sheet already has 80+ rows of historical data and the deduplication logic must account for that from day one.
