# Multi-Tenant Roadmap — Inventory Platform

> **Status:** Proposal / architecture roadmap. **Not yet approved — no phase
> below has been started.** Grounded in the code as of 2026-08-03, `main` after
> the Auth.js Google-login merge (commit `ca335b6`). Auth.js Google login +
> email allowlist is LIVE in production; everything else is single-tenant.
>
> **One-line thesis:** The app is single-tenant in every layer except the login
> that just shipped. Going multi-tenant is dominated by **two hard problems** —
> (1) replacing the one-hardcoded-Google-Sheet storage model with a real
> per-tenant data store, and (2) passing Google's **OAuth verification /
> security assessment for restricted Gmail scopes** on a public app. Everything
> else is tractable engineering. The right sequence de-risks the data model
> first (internally, no external gate) and treats Google verification as a
> long-lead procurement item started in parallel.

## For the next agent — start here

You are likely picking this up cold, possibly in a fresh session. Before acting:

1. **This is a roadmap, not an approved plan.** Nothing here is committed to.
   The product decision (go multi-tenant at all?) is unresolved — see §8. Do NOT
   start building phases without the user's explicit go-ahead on a specific one.
2. **Read these first to ground yourself** (the roadmap cites them throughout):
   `CLAUDE.md` (project vision + golden rule), `lib/sheets.ts` (the entire
   storage layer), `apps/cron/pipeline.ts` (ingest), `auth.ts`/`auth.config.ts`/
   `lib/authAllowlist.ts` (the shipped login), `app/lib/apiGuards.ts` (global
   cost cap). The "Appendix — key files" at the bottom is the full map.
3. **The recommended first buildable step is P0 + P1** (§7) — the `Store`
   interface seam and de-globalizing the chat singleton. They're low-risk hygiene
   that happen to unlock tenancy, and they change no user-facing behavior. Start
   there *if and only if* the user greenlights the direction.
4. **To execute any phase, first turn it into a proper TDD implementation plan**
   (superpowers:writing-plans) — this doc gives the what/why and sequencing, not
   step-by-step tasks. Treat each phase (P0, P1, …) as its own plan.
5. **The two things that will hurt** are the data-model migration (internal,
   controllable) and Google's OAuth verification + CASA assessment (external,
   ~6–12+ weeks, $4k–$75k/yr — start the clock the day "public" is chosen).
   Don't let anyone believe the second one can be compressed with engineering.

---

## 0. Where we are today (the single-tenant reality)

Two *different* Google OAuth consents already exist and must not be conflated:

| | Login OAuth (shipped) | Ingest OAuth (original) |
|---|---|---|
| Configured in | `auth.config.ts`, `auth.ts` (Auth.js Google provider) | `scripts/auth.ts` |
| Scopes | `openid email profile` (non-sensitive) | `gmail.modify` + `spreadsheets` (**restricted** + sensitive) |
| Token lifetime | JWT session, no refresh token stored | **offline** refresh token, one, in env |
| Where the token lives | Nowhere persistent — `session.strategy='jwt'`, **no DB** | `GOOGLE_REFRESH_TOKEN` env var (Tom's) |
| Who it authorizes | *Which humans may open the web UI* (email allowlist, `lib/authAllowlist.ts`) | *Whose Gmail + Sheet the whole app reads/writes* (Tom's) |

Every service resolves the same three env vars and acts as Tom:

- `apps/cron/index.ts` `readEnv()` → `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` + **one** `GOOGLE_SHEET_ID`, passed into `runPipeline` (`apps/cron/pipeline.ts`).
- `apps/bot/index.ts` → same creds + a single `TELEGRAM_CHAT_ID`; the whole bot is "Tom's DM".
- `app/lib/photo-brain.ts` → same creds; the chat is a `globalThis.__photoBrain` **singleton** and `PhotoBrainChatService` hardcodes `chatId = 'web'` (`domains/photography/chatService.ts`).
- `app/lib/apiGuards.ts` → rate-limit buckets keyed by **IP**, and `spendTotal` is a **single module-global** number with one `DAILY_LLM_BUDGET_USD` ceiling for the entire deployment.

Storage is one spreadsheet. `lib/sheets.ts` (1300 lines) is the entire persistence layer, and **every function takes `(sheets, spreadsheetId)` positionally** — `readMasterRows`, `appendRows`, `updateRowFields`, `buildVocab`, `readDedupKeys`, plus ~10 tab-specific helpers (Camping Index, Dispersed Sites, Camping Trips, Maintenance Acked, Cron Log, Rejected Images, Needs Review). Columns are resolved by **header name** via `buildHeaderMap`, which is a genuine asset for migration (see §1).

**Framing this honestly (PM lens): this is a different product** than `CLAUDE.md`
describes. The "golden rule" is *ship one domain end-to-end before starting
another*; the whole project is explicitly "personal context × domain expertise."
Multi-tenant SaaS is a **product pivot**, not a feature. See §8 before committing.

---

## 1. Tenancy data model — the load-bearing decision

### Option A — Per-user Google Sheets (one spreadsheet per tenant)

Keep the current code shape; `spreadsheetId` simply comes from a per-user record
instead of an env var. Superficially minimal because `lib/sheets.ts` already
takes `spreadsheetId` as an argument everywhere.

**Why it breaks down at N users, specific to this code:**

- **Google API quotas are per-project, not per-sheet.** Sheets API default is
  ~300 read + 300 write requests/min/project and 60/min/*user*. Our code is
  chatty: a single `runPipeline` call does `buildVocab` → `readMasterRows`,
  `readDedupKeys` → `readMasterRows` again, then `appendRows` (re-reads header),
  then per-return `updateRowStatus` (re-reads header each time), plus
  `resolveImage`. The camping cron's `mirrorCampingIndex` already had to batch
  "N facilities = 1 request instead of N" to stay under 60/min/**user** (comment
  at `lib/sheets.ts:794`). Multiply that by every tenant iterated in one cron
  tick and the **project-wide** quota is the ceiling. You'd be rate-limited into
  a slow serial crawl across tenants.
- **No cross-tenant queries.** "How many users, how much spend, who has a stuck
  Needs Review row" requires fanning out N `spreadsheets.get` calls. No
  aggregate is possible without a real DB anyway.
- **Every tab-ensure runs per tenant.** `ensureCronLogTab`, `ensureCampingIndexTab`,
  `ensureMaintenanceAckedTab`, etc. each do a `spreadsheets.get` + conditional
  `batchUpdate`. That's fixed per-tenant overhead on every write path.
- **Provisioning is slow and failure-prone** — creating + templating a sheet per
  signup (bootstrap-sheet logic) is an API round-trip storm at the worst moment
  (first-run).
- **Sharing/ownership headaches** — sheets owned by the service account vs. the
  user; if user-owned, we need their `spreadsheets` scope (restricted-ish) and
  they can delete/corrupt the schema out from under us.

**Where it's fine:** a *handful* of trusted users (the "cheapest viable
multi-user" milestone, §7). At 3–10 tenants the quota math holds and provisioning
cost is negligible. This is the pragmatic bridge, not the destination.

### Option B — Postgres on Railway (recommended)

Introduce a real relational store. Railway offers managed Postgres as a service
in the same project; the four services attach via `DATABASE_URL`. This is a
**strangler-fig** move: the sheet stays as tenant #1's store, new tenants land in
Postgres, and `lib/sheets.ts` becomes one implementation behind a repository
interface.

**Recommendation: Option B, reached via Option A as an interim.** Start
per-user-sheet for the first 2–5 trusted tenants (cheapest path to *any* second
user), but do it **behind a `Store` interface** so the Postgres cutover doesn't
touch call sites. Do not build the public product on sheets.

### What introducing `tenant_id` actually touches (blast radius)

The good news: because access is by header name and everything already threads
`spreadsheetId`, the change is **mechanical and localized to a seam**, not a
rewrite of business logic.

**Proposed seam:** a `Store` interface (e.g. `lib/store/Store.ts`) that owns
every method currently exported from `lib/sheets.ts`, each gaining a leading
`tenantId`:

```
readMasterRows(tenantId) / appendRows(tenantId, rows) / updateRowFields(tenantId, …)
buildVocab(tenantId) / readDedupKeys(tenantId)
+ camping/maintenance/cronlog/needsreview/rejected-images equivalents
```

Two implementations:
- `SheetsStore` — wraps today's `lib/sheets.ts` functions, resolving
  `tenantId → spreadsheetId` from a tenant registry. ~zero logic change.
- `PgStore` — SQL. Tables: `tenants`, `items` (the `MasterRow` shape → typed
  columns; `MasterRow` in `lib/types.ts` is already the canonical schema),
  `camping_index`, `dispersed_sites`, `camping_trips`, `maintenance_acks`,
  `needs_review`, `cron_log`, `rejected_images`, `photography_assignments`,
  `photography_progress`. Every table gets `tenant_id` + a composite index.

**Call-site blast radius (all pass `(sheets, spreadsheetId)` today → `(store, tenantId)`):**

| Area | Files | Notes |
|---|---|---|
| Cron pipeline | `apps/cron/pipeline.ts`, `apps/cron/index.ts` | Wrap the whole run in a per-tenant loop (§2). |
| Camping cron | `apps/cron/camping/*` (5 ticks) | Each tick becomes per-tenant; the Muted/Notes "sheet is source of truth" trick (`lib/sheets.ts:876`) must move into the store. |
| Bot | `apps/bot/index.ts`, `apps/bot/router.ts`, `apps/bot/handlers.ts`, `apps/bot/commands/*` | Map Telegram `chat_id → tenantId`; today it's one hardcoded chat. |
| Web reads | `app/**` server components + `app/api/**` routes, `app/lib/photo-brain.ts` | Resolve `tenantId` from the Auth.js session (`session.user.email` → tenant). |
| Domain query helpers | `domains/outdoor/inventory.ts`, `domains/photography/inventory.ts`, `serialize.ts`, `curriculum.ts` | These take an in-memory `MasterRow[]` and are **already tenant-agnostic** — they just filter the array. **No change** beyond being handed the right tenant's rows. This is the big relief: domain logic doesn't learn about tenancy. |
| Dedup | `lib/dedup.ts`, `lib/productId.ts` | Keys `(Order ID, productId)` etc. are **naturally per-tenant** once the row set is scoped — but the dedup index MUST be built from the tenant's rows only. In Postgres, add `tenant_id` to every dedup query. A cross-tenant leak here is a correctness bug (one user's order suppressing another's). |
| Vocab / classifier | `lib/classifier.ts`, `buildVocab` | Vocabulary is per-tenant (each user's brand/category history). Already derived from `readMasterRows`, so it follows the row scoping for free. |

**Estimate:** the `Store` interface + `SheetsStore` adapter is **M** (a day or
two — mostly threading `tenantId` and moving the ~10 tab helpers). `PgStore` +
schema + migration of Tom's data is **L**. The relief is that
`domains/**` and the parsers (`lib/parsers/**`) are pure functions over
in-memory data and need **no tenancy awareness at all**.

---

## 2. Per-user Gmail ingest (the second hard gate)

### 2a. Login must capture and store each user's Gmail refresh token

Today the login (`auth.config.ts`) requests only `openid email profile` — it
proves identity but **cannot read Gmail**. To ingest a user's orders we must
additionally obtain their **offline** `gmail.readonly` (or `gmail.modify`, if we
keep the "apply processed label" behavior in `lib/gmail.ts`) + optionally
`spreadsheets` consent, and store the resulting **refresh token per user,
encrypted**.

Concrete changes:

- Extend the Auth.js Google provider with `authorization.params`:
  `access_type: 'offline'`, `prompt: 'consent'`, and the incremental scopes.
  Mirror what `scripts/auth.ts` does today (`access_type:'offline', prompt:'consent'`)
  but inside the web login instead of a one-off CLI.
- Add the Auth.js **JWT/`account` callback** to capture `account.refresh_token`
  on first grant and persist it. `session.strategy` is currently `'jwt'` with
  **no database** — this forces introducing a persistence layer (the same
  Postgres from §1, or the Auth.js adapter) to hold `tenants.gmail_refresh_token`.
- **Encrypt at rest.** Refresh tokens are bearer credentials to a user's inbox.
  Use envelope encryption (a `TOKEN_ENC_KEY` app secret; AES-GCM per token).
  Never log them (contrast `scripts/auth.ts`, which writes the token to `.env`
  in plaintext — fine for one self-hosted owner, unacceptable for others' tokens).
- **Consider decoupling** the two consents: keep login as `openid email profile`
  (low friction, lets people in), then a separate **"Connect Gmail"** step that
  requests the restricted scope only when the user opts into ingest. This limits
  how many users trigger the restricted-scope surface and improves conversion.

### 2b. Cron changes from one token to iterating all tenants

`apps/cron/index.ts::readEnv()` hard-requires a single `GOOGLE_REFRESH_TOKEN`.
The new shape:

```
for (const tenant of activeTenants) {          // from the tenant registry
  const gmail  = createGmailClient({ …, refreshToken: decrypt(tenant.gmailRefreshToken) });
  const store  = storeFor(tenant);             // SheetsStore or PgStore
  await runPipeline({ …, tenantId: tenant.id, gmailClient: gmail, store });
}
```

Implications to design for **before** writing the loop:

- **Quota + fairness.** Serial iteration is simplest and safest for the Gmail
  per-user quota (each tenant is a different Google user, so Gmail quotas don't
  stack the way project-wide Sheets quotas do — but the Anthropic classifier and
  image-resolve calls do). Add a concurrency cap and per-tenant time budget.
- **Isolation of failure.** One tenant's expired/revoked token or malformed email
  must not abort the run for everyone. `runPipeline` already collects
  `result.errors[]` per message; wrap each *tenant* in the same try/catch and
  record per-tenant Cron Log rows.
- **Token expiry/revocation handling.** A revoked grant → mark the tenant
  `ingest_disabled`, notify them (email), skip. Today a bad token just crashes.
- **`INGEST_AFTER_DATE` / labels become per-tenant.** The `PROCESSED_LABEL` and
  the `-label:` Gmail query in `buildQuery` operate in each user's own mailbox —
  fine, but the "first run ingests history" empty-state (§5) needs per-tenant
  `ingestAfterDate`.

### 2c. Google OAuth verification / security assessment — THE hard external gate

`gmail.readonly` and `gmail.modify` are **Restricted** scopes under Google's API
Services User Data Policy. Today Tom's app is in effect a personal/testing app
(the `CLAUDE.md` note about publishing the consent screen to avoid 7-day refresh
expiry is exactly this — it's published but used by one person). Serving the
**public** requires:

- **OAuth app verification** (brand review of the consent screen, homepage,
  privacy policy, domain ownership). Weeks.
- **Restricted-scope verification**, which for Gmail requires an annual
  **third-party security assessment (CASA — Cloud Application Security
  Assessment)** at the appropriate tier. This is the dominating item:
  - A real vendor engagement (Google publishes a list of authorized assessors).
  - **Cost:** commonly **$4k–$75k/yr** depending on tier/vendor; a small app
    typically lands at the lower CASA Tier 2 self-scan + verification end.
  - **Timeline:** realistically **6–12+ weeks** end to end, longer on first pass.
  - Requirements include: a published **privacy policy** that specifically
    describes Gmail data use and Limited Use compliance, encryption at rest/in
    transit (drives §2a), incident response, data-deletion, and pen-test-style
    scanning.
- **Limited Use requirements**: you may not use Gmail data to train models, must
  not transfer it except to provide the user-facing feature, etc. Feeding order
  emails to the Anthropic classifier is a **data transfer to a third party** —
  must be disclosed and contractually covered (Anthropic's zero-retention / no-
  training posture helps, but it must be stated in the privacy policy and the
  CASA scope).

**This is a procurement-shaped, calendar-time gate that engineering cannot
compress.** Start it the day you decide to go public. Until it clears, you are
restricted to: (a) users you add as **test users** on the OAuth app (Google caps
this, ~100), or (b) users within a **Google Workspace org** you control
(internal). That cap is exactly why the "cheapest viable multi-user" milestone
(§7) is trusted-users-only — it lives *under* the verification gate.

---

## 3. State & secret isolation

| Thing today | Multi-tenant disposition |
|---|---|
| **`/data` Railway volume** (images `sha1(itemId)`, sheet backups, camping snapshots, URL caches) — single-attach, shared | **Split.** Per-tenant **user data** (order images `IMAGE_STORAGE_ROOT`, sheet/DB backups) must be namespaced by tenant: `/<tenant_id>/images/…`, and ideally moved to **object storage** (Railway buckets / S3) since a single-attach volume can't scale across replicas. **Shared app data** (dispersed-site snapshot, dispersed URL cache, image-URL cache for public product lookups) stays **global** — it's reference data, not user data. |
| **`globalThis.__photoBrain` singleton + `chatId='web'`** (`app/lib/photo-brain.ts`, `chatService.ts`) | **Per-tenant.** The singleton bakes in Tom's sheet creds at construction. Replace with a **keyed registry** `Map<tenantId, PhotoBrain>` (or construct per-request from the session), and set `chatId = tenantId` in `PhotoBrainChatService`. The `ConversationStore` (30-min TTL, in-memory) is fine to keep in-memory but must be **keyed by tenant** so histories can't cross. Same for the bot's per-`chat_id` `ConversationStore`. |
| **Camping state** (Camping Index / Dispersed Sites / Camping Trips tabs; `/data/*.json`) | **Mixed.** *Dispersed Sites* is reference data → **shared**. *Camping Index* Muted/Notes and *Camping Trips* are user intent → **per-tenant**. The "sheet is the cross-service source of truth" pattern (`readCampingIndexFromSheet`, `readCampingTripsFromSheet`) becomes per-tenant tables in `PgStore`. Release-moment alerts (`apps/cron/camping/*`) must fan out per tenant. |
| **One `ANTHROPIC_API_KEY`** | **Stays shared app infra** (you pay). This is the cost-exfiltration risk — see §4. Do **not** ask users for their own key in v1 (kills onboarding); meter instead. |
| **`TELEGRAM_BOT_TOKEN` + single `TELEGRAM_CHAT_ID`** | Bot token stays one (one bot). `TELEGRAM_CHAT_ID` must become a **per-tenant mapping** (`tenants.telegram_chat_id`), populated by a pairing flow (`telegram:configure`-style). Until built, Telegram can be **Tom-only** and the web is the multi-tenant surface. |
| **`WEB_USER`/`WEB_PASSWORD` HTTP Basic Auth** (`middleware.ts` note references it; the shipped middleware is Auth.js) | Basic Auth is obsolete once Auth.js is the gate — remove to avoid a second, weaker door. |
| Weather / Rec.gov / Nominatim / Overpass keys | **Shared app infra** — external reference APIs, not user-scoped. Watch their rate limits multiply with tenants (Nominatim's ≥1s/req policy especially). |

---

## 4. Per-user cost control & billing

**The single most dangerous property of going public: a public app on your own
`ANTHROPIC_API_KEY`.** Today `app/lib/apiGuards.ts` is the only brake and it is
**global**: one `spendTotal`, one `DAILY_LLM_BUDGET_USD` (default `$5`) for the
entire deployment, rate-limited by IP. Under multi-tenant this means **one abuser
can consume the whole app's daily budget and DoS every other user** — or, worse,
run up an unbounded bill before the cap trips, since the cap is best-effort
in-memory and resets per process/replica.

Required changes:

- **Per-tenant metering.** Move `recordSpend`/`overDailyBudget` from module
  globals to a **per-tenant** ledger in Postgres (`usage_events`: tenant_id,
  ts, model, input/output tokens, est_usd). `lib/models.ts` already centralizes
  pricing — reuse it to compute `est_usd` at each call site (photo-brain, outdoor
  agent, classifier, expander, grading, parsers).
- **Per-tenant quotas.** Daily/monthly token or dollar ceilings per tenant, with
  a hard stop that returns a friendly "quota reached" instead of silently
  overspending. Rate-limit keyed by **tenant**, not IP (`clientKey` today).
- **Global circuit breaker** stays as a backstop (protect the *account*), but the
  first line of defense is per-tenant.
- **Cost visibility** — the existing Cron Log / stats plumbing can be extended to
  a per-tenant usage view in the web UI.

**Is billing needed?** For the trusted-users milestone (§7): **no** — a generous
per-tenant quota on your key is fine among a few known people. For public
self-serve: **yes**, or you are personally financing strangers' LLM usage.
Shape: **Stripe** (Railway has no native billing) with usage-based or flat tiers,
metered off the `usage_events` ledger. A "bring-your-own Anthropic key" option is
a cheap pressure-release valve for power users but shouldn't be the only path.
Billing is an **L** with an external dependency (Stripe onboarding, tax, dunning)
— defer past the first paying cohort but design the `usage_events` ledger now so
billing is a read over existing data.

---

## 5. Onboarding / provisioning / account lifecycle

- **Signup.** Auth.js Google login already handles identity. Replace the
  **allowlist gate** (`lib/authAllowlist.ts`, `AUTH_ALLOWED_EMAILS`) with: (a)
  allowlist for the trusted milestone, then (b) open signup that **creates a
  `tenants` row** on first `signIn`. The `signIn` callback in `auth.config.ts` is
  exactly the hook — today it returns a boolean; extend it to upsert the tenant.
- **Connect Gmail (first-run).** Separate opt-in step (§2a) that grants the
  restricted scope and stores the encrypted refresh token. Gate ingest on it.
- **Empty-state ingest.** A brand-new tenant has an empty inventory. First run
  should backfill history: the pipeline already supports `ingestAfterDate` /
  `--since` / `newer_than:30d` (`buildQuery` in `apps/cron/pipeline.ts`). Offer
  the user a "how far back?" choice; run an initial deeper scan once, then settle
  into the hourly cadence. Watch cost — a heavy first scan hits the classifier a
  lot (meter it, §4).
- **Provisioning.** `SheetsStore` path: create + template a sheet per tenant
  (reuse `scripts/bootstrap-sheet.ts` logic, the tab-`ensure*` functions do most
  of it). `PgStore` path: just insert a `tenants` row — provisioning is a no-op,
  which is another reason to prefer Postgres.
- **Deletion / GDPR.** Required for CASA and basic decency: a
  "delete my account + data" flow that (a) revokes the stored Gmail grant, (b)
  deletes the tenant's rows across all tables, (c) deletes their images/backups
  from object storage, (d) purges in-memory conversation state. Trivial in
  Postgres (`DELETE … WHERE tenant_id = ?` + object-store prefix delete);
  painful with per-user sheets (delete/unshare each spreadsheet). Another point
  for Postgres.
- **Allowlist → open-signup transition.** Keep the allowlist as a **feature
  flag** even after opening up (for staged rollout / emergency close). The switch
  is `AUTH_ALLOWED_EMAILS` present ⇒ closed beta; absent ⇒ open. This transition
  is **gated on §2c** — you literally cannot open signup for Gmail ingest until
  verification clears.

---

## 6. Migration path (strangler-fig, no big-bang)

Tom's data becomes **tenant #1** and never moves until the very end.

1. **Introduce the `Store` interface with only `SheetsStore` behind it.**
   Thread `tenantId` everywhere, but there's exactly one tenant (Tom), whose
   `tenantId → spreadsheetId` resolves to today's `GOOGLE_SHEET_ID`. **Behavior
   identical, zero user-visible change.** This is the keystone commit and is
   safe to ship incrementally (start with the web read path, then bot, then cron).
2. **Add a tenant registry** (small Postgres table or even a JSON/env map at
   first) mapping `email → { tenantId, spreadsheetId, gmailRefreshToken }`. Tom
   is the only row.
3. **Onboard trusted tenant #2 as a second Google Sheet** (Option A). This
   proves the whole per-tenant loop — cron iteration, per-tenant chat, per-tenant
   quota — **without** the Postgres migration. Cheapest possible second user.
4. **Stand up Postgres + `PgStore`.** New tenants land in Postgres; existing
   sheet tenants keep using `SheetsStore`. The `Store` interface makes them
   coexist. This is the strangler boundary.
5. **Backfill/migrate sheet tenants into Postgres** one at a time with a
   `scripts/migrate-tenant.ts` (read via `SheetsStore`, write via `PgStore`,
   diff-verify). Tom migrates **last**, only once the path is proven on others.
6. **Retire `SheetsStore`** once no tenant uses it (or keep it as an
   export/backup format — the daily backup already snapshots the whole sheet).

Each step is independently shippable and reversible. No flag day.

---

## 7. Phased plan, sizing, dependencies, sequence

Sizing: **S** ≈ hours, **M** ≈ 1–2 days, **L** ≈ ~1 week, **XL** ≈ multi-week /
external gate.

| Phase | What | Size | Hard dependency | De-risks |
|---|---|---|---|---|
| **P0 — Store seam** | Extract `Store` interface, `SheetsStore` adapter, thread `tenantId` (one tenant = Tom). No behavior change. | **M** | none (internal) | The entire data-model refactor, safely, with one user. |
| **P1 — Tenant registry + session→tenant** | `tenants` table/map; resolve `tenantId` from Auth.js session; per-tenant chat registry (kill `globalThis` singleton + `chatId='web'`); per-tenant conversation keying. | **M** | P0 | State isolation bugs surface with 1–2 tenants, not 100. |
| **P2 — Per-user Gmail connect + encrypted token store** | "Connect Gmail" opt-in, offline restricted scope, AES-GCM token storage, revocation handling. | **L** | P1; token store (Postgres or adapter) | The token-handling design ahead of the loop. |
| **P3 — Cron per-tenant loop** | Iterate active tenants in `apps/cron/*` + `apps/cron/camping/*`; per-tenant Cron Log; failure isolation; per-tenant first-run backfill. | **L** | P2 | Quota + fairness + failure-isolation empirically. |
| **P4 — Per-tenant metering + quotas** | Move `apiGuards` to per-tenant Postgres ledger; `usage_events`; hard per-tenant caps; global backstop. | **M** | P1 | **Cost-exfiltration risk before any semi-public exposure.** |
| **⭐ MILESTONE A — "Cheapest viable multi-user"** | 2–5 **trusted** users, **manual provisioning**, per-user sheets (Option A) OR early Postgres, allowlist ON, **under** Google's test-user cap, no billing. | — | P0–P4 | Proves product value before paying for verification. |
| **P5 — Postgres `PgStore` + migration tooling** | Schema, `PgStore`, `scripts/migrate-tenant.ts`, coexistence with `SheetsStore`. | **L** | P0 (interface) | Scale + cross-tenant queries + clean deletion. |
| **P6 — Object storage for user data** | Move `/data` images + backups to per-tenant buckets; keep shared reference data global. | **M** | P1 | Single-attach volume ceiling; multi-replica web. |
| **P7 — Account lifecycle** | Signup-creates-tenant, GDPR delete, allowlist→flag, empty-state UX. | **M** | P1, P5 | Compliance prerequisites for verification. |
| **P8 — Google OAuth verification + CASA** | Consent-screen verification, restricted-scope security assessment, privacy policy, Limited-Use compliance. | **XL** | P2, P7 (privacy policy, deletion, encryption must exist first) | **The gate to any public user. Start in parallel with P2 — it's calendar time, not engineering time.** |
| **P9 — Billing** | Stripe, usage-based tiers metered off `usage_events`, optional BYO-key. | **L** | P4 ledger; external (Stripe) | Financial sustainability of public launch. |
| **⭐ MILESTONE B — "Public self-serve SaaS"** | Open signup, billing live, verification cleared. | — | P5–P9 | — |

**Critical path / sequence that de-risks earliest:**
`P0 → P1 → (P2 ∥ start P8 clock) → P3 → P4 → Milestone A`. Ship real value to a
few humans **before** spending a dollar on CASA. Then `P5 → P6 → P7`, with **P8
running in the background the entire time** because it's the long pole. `P9` last.

**The two gates that dominate everything:**
1. **Data-model migration (P0/P5)** — internal, controllable, strangler-fig.
2. **Google verification + CASA (P8)** — external, calendar-bound, costs money,
   cannot be compressed by working harder. **Start it the moment public is the
   goal.**

---

## 8. Scope & risk callout (PM lens)

**This roadmap describes a different product than `CLAUDE.md` does.** The current
product is deliberately, explicitly personal: *"personal context multiplied by
domain expertise,"* golden rule *"ship one domain end-to-end before starting
another."* Multi-tenant SaaS is a **pivot in product identity**, and it competes
directly with the golden rule for attention.

Be honest about what going multi-tenant **deliberately deprioritizes**:

- **Domain depth.** Every hour on tenancy plumbing is an hour not spent making the
  outdoor/photography agents better — which is the *actual* differentiated value.
  A multi-tenant app with a mediocre agent is worse than a single-tenant app with
  a great one.
- **The "Tom's gear, Tom's trails" magic.** The product's charm is the tight
  personal fit. Generalizing it risks regressing to a generic "email → spreadsheet"
  tool that competes with well-funded incumbents on undifferentiated ground.
- **Velocity.** P0–P4 alone is several weeks of infra work with **zero new
  user-facing capability** — pure enablement. That's a hard sell against shipping,
  say, the Kitchen domain or better grading.

**Recommendation (top-line):**
1. **Do not build the public SaaS yet.** The evidence you need first is *demand
   from real other people* — which you can get from **Milestone A** (2–5 trusted
   users, manual provisioning, no verification, no billing) for a fraction of the
   cost. Build **P0 and P1 regardless** — the `Store` seam and killing the
   `globalThis`/`chatId='web'` singletons are good hygiene that also happen to
   unlock tenancy, and they're low-risk.
2. **Treat P0 → Milestone A as an experiment, not a commitment.** If trusted
   users love it, *then* start the P8 verification clock and commit to P5–P9. If
   they don't, you've spent ~M+L, not an XL + a five-figure CASA invoice.
3. **The technical order is settled** even if the product decision isn't: the
   `Store` interface first, Postgres second, per-user Gmail tokens third,
   verification running in parallel from the moment "public" is chosen. Data
   model and Google verification are the two things that will hurt; everything
   else is ordinary work.

---

### Appendix — key files referenced

- Storage layer (all per-tenant work centers here): `lib/sheets.ts`,
  `lib/dedup.ts`, `lib/productId.ts`, `lib/types.ts`
- Ingest: `apps/cron/index.ts`, `apps/cron/pipeline.ts`, `lib/gmail.ts`,
  `scripts/auth.ts`, `apps/cron/camping/*`
- Auth (shipped): `auth.ts`, `auth.config.ts`, `lib/authAllowlist.ts`,
  `middleware.ts`
- Chat/agents (singletons to de-globalize): `app/lib/photo-brain.ts`,
  `domains/photography/chatService.ts`, `apps/bot/index.ts`, `lib/router.ts`
- Cost control (global → per-tenant): `app/lib/apiGuards.ts`, `lib/models.ts`
- Domain query helpers (tenant-agnostic, no change): `domains/outdoor/inventory.ts`,
  `domains/photography/inventory.ts`, `serialize.ts`, `curriculum.ts`
</content>
</invoke>
