# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security gaps found in the 2026-08-03 adversarial audit so the app is safe on its public hostname and safe to eventually open to a partner — with the paid-API spend, fail-open auth, and injection/SSRF/XSS paths fixed first.

**Architecture:** Small, surgical fixes layered onto the existing Next.js App Router app. New guard utilities live in `app/lib/` (web-only, Node runtime) and `lib/integrations/` (shared). No framework changes, no new services. Rate-limiting and spend tracking are in-memory (the web service is a single Railway instance — documented as a known limitation, not a distributed store).

**Tech Stack:** Next.js 14 (App Router, Node + Edge runtimes), TypeScript strict, vitest, `isomorphic-dompurify` (new), `googleapis` Sheets client.

## For the next agent — start here

You are picking this up cold. Before Task 1:

1. Read `SECURITY-AUDIT.md` (repo root) — the findings this plan closes. Each task also restates its finding, so you don't need the original audit conversation.
2. Read `CLAUDE.md` (repo root) — project rules. Note: **`CLAUDE.md`, `docs/PLAN.md`, `DECISIONS.md` must not be modified without Tom's explicit confirmation** (affects Tasks 9, 11, 12).
3. Baseline the tooling so you know green-from-here: `npm test` and `npm run typecheck` should both pass on `main` before you start. If they don't, stop and report — don't build on a red baseline.
4. Conventions you must match (verified in this repo):
   - Tests live under `tests/**/*.test.ts` and **mirror the source path**: a test for `app/lib/x.ts` goes in `tests/app/lib/x.test.ts`; for `lib/x.ts` → `tests/lib/x.test.ts`. (Existing examples: `tests/app/lib/kpi.test.ts`, `tests/lib/...`.)
   - vitest runs in the `node` environment (`vitest.config.ts`). No test in this repo imports `next/server` or React components — **keep it that way**: this plan tests plain modules, never Next route handlers or JSX directly.
   - Import suffixes: files under `lib/`/`domains/`/`apps/` use the NodeNext `.js` suffix (`import { x } from './y.js'`); files under `app/` use no suffix (bundler mode). Match the file you're editing.
5. Run one task at a time, verify its `Expected:` output, then commit. Do not batch commits.

## Global Constraints

- TypeScript strict mode; two tsconfigs — `tsconfig.json` (Next bundler, `app/` + `middleware.ts`), `tsconfig.node.json` (NodeNext, `lib/`/`apps/`/`tests/`, `.js` import-suffix convention). `npm run typecheck` runs both and MUST pass.
- `lib/` must not import from `domains/`. `app/lib/` may import from `lib/` and `domains/`.
- Vitest for tests; fixtures in `tests/fixtures/`. Run all tests with `npm test`.
- Conventional-commit prefixes (`feat:`/`fix:`/`chore:`/`test:`/`docs:`). One commit per task, referencing the audit finding.
- Do NOT weaken the Telegram bot's `authorizedChatIds` gate or the image-serving route's `^[a-f0-9]{16}\.(jpg|jpeg|png|webp)$` filename regex — both were confirmed safe by the audit.
- The four paid-LLM routes are: `app/api/photography/chat/route.ts`, `.../learn/route.ts`, `.../start/route.ts`, `.../submit/route.ts`.

---

## Phase 1 — Money & fail-safe (do first)

### Task 1: Fail auth closed in production (via a testable auth-decision module)

**Finding:** `middleware.ts:17` returns `undefined` (no auth on any route, including all paid + mutating APIs) whenever `WEB_USER`/`WEB_PASSWORD` are unset — silently. Confirmed live that vars are currently set, but one bad redeploy exposes everything.

**Why a new module:** we do not want any test importing `next/server` (no precedent in this repo; vitest runs in `node`). So the auth *decision* moves into a plain, edge-safe module `app/lib/authGate.ts` that returns a descriptor; `middleware.ts` becomes a thin wrapper that maps the descriptor to a `NextResponse`. Tests target `authGate.ts` only. This same module carries the Task 8 throttle and Task 10 constant-time compare.

**Files:**
- Create: `app/lib/authGate.ts`
- Modify: `middleware.ts`
- Test: `tests/app/lib/authGate.test.ts` (create)

**Interfaces:**
- Produces: `type AuthDecision = { action: 'pass' } | { action: 'reject'; status: 401 | 429 | 500; headers?: Record<string,string> }`.
- Produces: `evaluateAuth(input: { authHeader: string | null; ip: string; nodeEnv: string | undefined; user: string | undefined; password: string | undefined }): AuthDecision`. Pure except for a module-level failure-throttle Map (reset via `__resetAuthGateForTest()`).
- Consumed by: `middleware.ts` (Task 1), extended in Tasks 8 and 10.

- [ ] **Step 1: Write the failing test**

```ts
// tests/app/lib/authGate.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateAuth, __resetAuthGateForTest } from '../../../app/lib/authGate';

const base = { ip: '1.2.3.4', user: 'u', password: 'p' } as const;
const okHeader = `Basic ${btoa('u:p')}`;

describe('evaluateAuth', () => {
  beforeEach(() => __resetAuthGateForTest());

  it('fails CLOSED (500) in production when creds are unset', () => {
    const d = evaluateAuth({ authHeader: null, ip: '1.2.3.4', nodeEnv: 'production', user: '', password: '' });
    expect(d).toEqual({ action: 'reject', status: 500 });
  });

  it('falls open outside production for local dev', () => {
    const d = evaluateAuth({ authHeader: null, ip: '1.2.3.4', nodeEnv: 'development', user: '', password: '' });
    expect(d).toEqual({ action: 'pass' });
  });

  it('rejects 401 when creds are set but header is wrong', () => {
    const d = evaluateAuth({ ...base, authHeader: 'Basic wrong', nodeEnv: 'production' });
    expect(d.action).toBe('reject');
    if (d.action === 'reject') expect(d.status).toBe(401);
  });

  it('passes when the header matches', () => {
    const d = evaluateAuth({ ...base, authHeader: okHeader, nodeEnv: 'production' });
    expect(d).toEqual({ action: 'pass' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/lib/authGate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `app/lib/authGate.ts`**

Edge-safe only (`btoa`, `Date.now`, `Map` — no Node APIs), because `middleware.ts` runs on the Edge runtime.

```ts
export type AuthDecision =
  | { action: 'pass' }
  | { action: 'reject'; status: 401 | 429 | 500; headers?: Record<string, string> };

export interface AuthInput {
  authHeader: string | null;
  ip: string;
  nodeEnv: string | undefined;
  user: string | undefined;
  password: string | undefined;
}

export function evaluateAuth(input: AuthInput): AuthDecision {
  const { authHeader, nodeEnv, user, password } = input;
  if (!user || !password) {
    // Fail CLOSED in production; fall open only for local dev.
    if (nodeEnv === 'production') return { action: 'reject', status: 500 };
    return { action: 'pass' };
  }
  const expected = `Basic ${btoa(`${user}:${password}`)}`;
  if (authHeader !== null && authHeader === expected) return { action: 'pass' };
  return {
    action: 'reject',
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Outdoor Inventory Dashboard"' },
  };
}

export function __resetAuthGateForTest(): void {
  // no state yet; Task 8 adds the failure-throttle Map cleared here.
}
```

- [ ] **Step 4: Rewrite `middleware.ts` as a thin wrapper**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { evaluateAuth } from './app/lib/authGate';

export function middleware(req: NextRequest): NextResponse | undefined {
  const decision = evaluateAuth({
    authHeader: req.headers.get('authorization'),
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    nodeEnv: process.env['NODE_ENV'],
    user: process.env['WEB_USER'],
    password: process.env['WEB_PASSWORD'],
  });
  if (decision.action === 'pass') return undefined;
  const body = decision.status === 500 ? 'Server misconfigured' : decision.status === 429 ? 'Too Many Requests' : 'Unauthorized';
  return new NextResponse(body, { status: decision.status, headers: decision.headers });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

Verify the import path resolves under Next's edge bundler: `middleware.ts` is at repo root, so `./app/lib/authGate` is correct. (Existing route files reach `app/lib` via relative paths; from the root middleware it is `./app/lib/authGate`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/app/lib/authGate.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (both tsconfigs — `authGate.ts` is under `app/`, `middleware.ts` is covered by the Next tsconfig).

- [ ] **Step 6: Commit**

```bash
git add app/lib/authGate.ts middleware.ts tests/app/lib/authGate.test.ts
git commit -m "fix(web): fail auth closed in production via testable authGate (audit #1)"
```

---

### Task 2: Shared in-memory rate limiter + daily spend guard

**Finding:** None of the four paid-LLM routes has any per-caller rate limit or spend ceiling; `chat` can issue up to 8 Opus 4.7 calls per message with no cap on calls/day.

**Files:**
- Create: `app/lib/apiGuards.ts`
- Test: `tests/app/lib/apiGuards.test.ts` (create)

**Interfaces:**
- Produces:
  - `clientKey(req: Request): string` — first `x-forwarded-for` IP, else `'unknown'`.
  - `checkRateLimit(key: string, opts?: { limit?: number; windowMs?: number }): { ok: true } | { ok: false; retryAfterMs: number }` — sliding-window token bucket, default 20 requests / 60_000 ms.
  - `recordSpend(estimatedUsd: number): void` and `overDailyBudget(): boolean` — running UTC-day total against `DAILY_LLM_BUDGET_USD` env (default `5`).
  - `__resetGuardsForTest(): void` — clears all in-memory state.

- [ ] **Step 1: Write the failing test**

```ts
// tests/app/lib/apiGuards.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clientKey, checkRateLimit, recordSpend, overDailyBudget, __resetGuardsForTest,
} from '../../../app/lib/apiGuards';

describe('apiGuards', () => {
  beforeEach(() => { __resetGuardsForTest(); vi.unstubAllEnvs(); });

  it('extracts the first x-forwarded-for IP', () => {
    const r = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } });
    expect(clientKey(r)).toBe('1.2.3.4');
  });

  it('allows up to the limit then blocks with a retryAfter', () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit('k', { limit: 3, windowMs: 1000 }).ok).toBe(true);
    const blocked = checkRateLimit('k', { limit: 3, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('trips the daily budget once cumulative spend exceeds the ceiling', () => {
    vi.stubEnv('DAILY_LLM_BUDGET_USD', '1');
    expect(overDailyBudget()).toBe(false);
    recordSpend(0.6);
    recordSpend(0.6);
    expect(overDailyBudget()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/apiGuards.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `app/lib/apiGuards.ts`**

```ts
// In-memory guards for the single-instance Railway web service.
// NOTE: state is per-process — if the web service is ever scaled to >1
// replica, move this to a shared store (Redis). Documented limitation.

type Bucket = { hits: number[] };
const buckets = new Map<string, Bucket>();

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_MS = 60_000;

export function clientKey(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  return first || 'unknown';
}

export function checkRateLimit(
  key: string,
  opts?: { limit?: number; windowMs?: number },
): { ok: true } | { ok: false; retryAfterMs: number } {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const windowMs = opts?.windowMs ?? DEFAULT_WINDOW_MS;
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= limit) {
    const retryAfterMs = windowMs - (now - b.hits[0]!);
    buckets.set(key, b);
    return { ok: false, retryAfterMs };
  }
  b.hits.push(now);
  buckets.set(key, b);
  return { ok: true };
}

let spendDay = '';
let spendTotal = 0;

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function recordSpend(estimatedUsd: number): void {
  const day = utcDay();
  if (day !== spendDay) { spendDay = day; spendTotal = 0; }
  spendTotal += estimatedUsd;
}

export function overDailyBudget(): boolean {
  const day = utcDay();
  if (day !== spendDay) { spendDay = day; spendTotal = 0; }
  const ceiling = Number(process.env['DAILY_LLM_BUDGET_USD'] ?? '5');
  return spendTotal >= ceiling;
}

export function __resetGuardsForTest(): void {
  buckets.clear();
  spendDay = '';
  spendTotal = 0;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/app/lib/apiGuards.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/apiGuards.ts tests/app/lib/apiGuards.test.ts
git commit -m "feat(web): add in-memory rate limiter + daily spend guard (audit #2)"
```

---

### Task 3: Wire rate limit + spend + body-size cap into the four paid routes

**Finding:** paid routes are ungated; bodies are fully buffered before any length check (memory DoS).

**Files:**
- Create: `app/lib/httpGuards.ts`
- Modify: `app/api/photography/chat/route.ts`, `app/api/photography/learn/route.ts`, `app/api/photography/start/route.ts`, `app/api/photography/submit/route.ts`
- Test: `tests/app/lib/httpGuards.test.ts` (create)

**Interfaces:**
- Consumes: `checkRateLimit`, `clientKey`, `overDailyBudget` from `app/lib/apiGuards`.
- Produces: `tooLargeByContentLength(req: Request, maxBytes: number): boolean` — true when the declared `Content-Length` exceeds `maxBytes`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/app/lib/httpGuards.test.ts
import { describe, it, expect } from 'vitest';
import { tooLargeByContentLength } from '../../../app/lib/httpGuards';

describe('httpGuards', () => {
  it('flags oversized bodies by Content-Length', () => {
    const big = new Request('http://x', { method: 'POST', headers: { 'content-length': String(2_000_000) } });
    expect(tooLargeByContentLength(big, 1_000_000)).toBe(true);
  });
  it('allows bodies within the cap', () => {
    const ok = new Request('http://x', { method: 'POST', headers: { 'content-length': '500' } });
    expect(tooLargeByContentLength(ok, 1_000_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app/lib/httpGuards.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `app/lib/httpGuards.ts`**

```ts
export function tooLargeByContentLength(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(len) && len > maxBytes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app/lib/httpGuards.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the guard preamble to `chat/route.ts` POST**

At the top of `POST` in `app/api/photography/chat/route.ts` (before `req.json()`), insert:

```ts
  if (tooLargeByContentLength(req, 64 * 1024)) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  const rl = checkRateLimit(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited' }, {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }
  if (overDailyBudget()) {
    return NextResponse.json({ error: 'daily_budget_exceeded' }, { status: 429 });
  }
```

Add the imports at the top of the file:

```ts
import { checkRateLimit, clientKey, overDailyBudget, recordSpend } from '../../../lib/apiGuards';
import { tooLargeByContentLength } from '../../../lib/httpGuards';
```

After a successful `getPhotoBrain().send(...)` returns, record an estimate:

```ts
    recordSpend(0.05); // rough Opus-turn estimate; refine once real usage is known
```

- [ ] **Step 6: Repeat the same preamble for `learn`, `start`, `submit`**

Apply the identical guard block at the top of each route's `POST`. Use a 64 KB cap for `learn`/`start` (JSON) and `20 * 1024 * 1024` for `submit` (multipart image). Add `recordSpend(0.02)` after `learn`/`start` succeed and `recordSpend(0.05)` after `submit` grades. Match each route's existing relative import depth for `app/lib/*` (`learn`/`start`/`submit` are at the same depth as `chat`: `../../../lib/...`).

Additionally, in `submit/route.ts`, enforce the retry cap the audit flagged: after loading the active assignment, if its `retryCount >= 5`, return `{ error: 'retry_limit' }` with status 429 before calling the grader.

- [ ] **Step 7: Verify typecheck + full test suite**

Run: `npm run typecheck && npm test`
Expected: PASS. Manually confirm with the dev server that a rapid loop of POSTs to `/api/photography/chat` starts returning 429 after 20 in a minute.

- [ ] **Step 8: Commit**

```bash
git add app/lib/httpGuards.ts app/api/photography tests/app/lib/httpGuards.test.ts
git commit -m "feat(web): rate-limit, spend-guard and body-size-cap paid LLM routes (audit #2, #3)"
```

---

## Phase 2 — Injection, XSS, SSRF (this week)

### Task 4: Neutralize spreadsheet formula injection in user free-text

**Finding:** `submit`'s `caption` is written to the sheet with `valueInputOption: 'USER_ENTERED'` (`lib/photographySheets.ts:321`); a leading `=`/`+`/`-`/`@` executes as a live formula in Tom's Sheet.

**Files:**
- Create: `lib/sheetSafe.ts`
- Modify: `lib/photographySheets.ts` (the `updateAssignment` write of `userNotes`)
- Test: `tests/lib/sheetSafe.test.ts` (create)

**Interfaces:**
- Produces: `neutralizeFormula(value: string): string` — prefixes a single `'` when the value begins with `= + - @` (after optional whitespace); returns other strings unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/sheetSafe.test.ts
import { describe, it, expect } from 'vitest';
import { neutralizeFormula } from '../../lib/sheetSafe.js';

describe('neutralizeFormula', () => {
  it('prefixes formula-leading characters', () => {
    expect(neutralizeFormula('=IMPORTXML("http://evil","//a")')).toBe("'=IMPORTXML(\"http://evil\",\"//a\")");
    for (const c of ['+', '-', '@']) expect(neutralizeFormula(`${c}x`)).toBe(`'${c}x`);
  });
  it('leaves normal captions untouched', () => {
    expect(neutralizeFormula('Shot at golden hour')).toBe('Shot at golden hour');
    expect(neutralizeFormula('')).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/sheetSafe.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/sheetSafe.ts`**

```ts
/** Neutralize Google Sheets / CSV formula injection in user-supplied text.
 *  With valueInputOption USER_ENTERED, a leading = + - @ is parsed as a live
 *  formula. Prefixing a single quote forces Sheets to store it as literal text. */
export function neutralizeFormula(value: string): string {
  if (/^\s*[=+\-@]/.test(value)) return `'${value}`;
  return value;
}
```

- [ ] **Step 4: Apply it to the userNotes write in `updateAssignment`**

In `lib/photographySheets.ts`, import at top: `import { neutralizeFormula } from './sheetSafe.js';`. Where `userNotes` is mapped for the batch write (the `['userNotes', 'user_notes']` field near line 303), wrap the value: write `neutralizeFormula(row.userNotes ?? '')` instead of the raw value. Leave the `USER_ENTERED` option as-is (it's needed for URL/number fields elsewhere in the same batch).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/lib/sheetSafe.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sheetSafe.ts lib/photographySheets.ts tests/lib/sheetSafe.test.ts
git commit -m "fix(sheets): neutralize formula injection in user captions (audit #4)"
```

---

### Task 5: Sanitize LLM/user markdown before rendering

**Finding:** `app/components/markdown.tsx` renders via `dangerouslySetInnerHTML` with no sanitizer; the chat drawer and learn/assignment views feed LLM/user-influenced text through it — a stored-XSS path via the shared `chatId='web'` history.

**Files:**
- Modify: `package.json` (add `isomorphic-dompurify`), `app/components/markdown.tsx`
- Test: `tests/app/markdown-sanitize.test.ts` (create)

**Interfaces:**
- Produces: `Markdown` component whose emitted HTML never contains `<script>`, inline event handlers, or `javascript:` URLs.

- [ ] **Step 1: Add the dependency**

Run: `npm install isomorphic-dompurify`
(Works in both the Node route runtime and SSR; no DOM needed at call time.)

- [ ] **Step 2: Write the failing test**

```ts
// tests/app/markdown-sanitize.test.ts
import { describe, it, expect } from 'vitest';
import DOMPurify from 'isomorphic-dompurify';

// Mirrors the component's transform; asserts the sanitizer strips active content.
function render(md: string): string {
  return DOMPurify.sanitize(md, { USE_PROFILES: { html: true } });
}

describe('markdown sanitization', () => {
  it('strips script tags and inline handlers', () => {
    const out = render('<img src=x onerror=alert(1)><script>alert(2)</script>ok');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('ok');
  });
  it('drops javascript: hrefs', () => {
    const out = render('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails / passes for the sanitizer itself**

Run: `npx vitest run tests/app/markdown-sanitize.test.ts`
Expected: PASS once the dep is installed (this test pins the sanitizer's behavior; the component change in Step 4 is what actually applies it).

- [ ] **Step 4: Sanitize inside the component**

Rewrite `app/components/markdown.tsx`:

```tsx
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

interface Props {
  text: string;
}

/** Render markdown to sanitized HTML. Safe for LLM- and user-influenced
 *  content: marked → DOMPurify strips scripts, event handlers, and
 *  javascript: URLs before it reaches dangerouslySetInnerHTML. */
export function Markdown({ text }: Props) {
  marked.use({ gfm: true, breaks: false });
  const raw = marked.parse(text, { async: false });
  const html = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  return (
    <div
      className="markdown-body text-[13px] leading-relaxed text-text-secondary"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 5: Verify typecheck + tests + build**

Run: `npm run typecheck && npm test && npm run web:build`
Expected: PASS; the build confirms `isomorphic-dompurify` bundles cleanly for the route/runtime.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/components/markdown.tsx tests/app/markdown-sanitize.test.ts
git commit -m "fix(web): sanitize markdown before dangerouslySetInnerHTML (audit #5)"
```

---

### Task 6: Block SSRF in the image-download path

**Finding:** `downloadAndSave(itemId, url)` (`lib/integrations/image-storage.ts:72`) fetches a user-supplied URL after only a `new URL()` syntax check — no block on `169.254.169.254`, loopback, RFC1918, or `*.railway.internal`.

**Files:**
- Create: `lib/integrations/ssrfGuard.ts`
- Modify: `lib/integrations/image-storage.ts` (`downloadAndSave`)
- Test: `tests/lib/ssrfGuard.test.ts` (create)

**Interfaces:**
- Produces: `assertPublicHttpUrl(url: string): Promise<{ ok: true } | { ok: false; error: 'bad_scheme' | 'private_host' }>` — rejects non-http(s) schemes and any hostname that resolves to a private/loopback/link-local/metadata address.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/ssrfGuard.test.ts
import { describe, it, expect } from 'vitest';
import { isPrivateAddress } from '../../lib/integrations/ssrfGuard.js';

describe('isPrivateAddress', () => {
  it('flags loopback, RFC1918, link-local and metadata', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', '::1'])
      expect(isPrivateAddress(ip)).toBe(true);
  });
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34'])
      expect(isPrivateAddress(ip)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ssrfGuard.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/integrations/ssrfGuard.ts`**

```ts
import { lookup } from 'node:dns/promises';

export function isPrivateAddress(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) return true;
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  return false;
}

export async function assertPublicHttpUrl(
  url: string,
): Promise<{ ok: true } | { ok: false; error: 'bad_scheme' | 'private_host' }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, error: 'bad_scheme' }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'bad_scheme' };
  if (parsed.hostname.endsWith('.railway.internal') || parsed.hostname === 'localhost')
    return { ok: false, error: 'private_host' };
  try {
    const { address } = await lookup(parsed.hostname);
    if (isPrivateAddress(address)) return { ok: false, error: 'private_host' };
  } catch {
    return { ok: false, error: 'private_host' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Enforce it in `downloadAndSave`**

In `lib/integrations/image-storage.ts`, import `assertPublicHttpUrl` from `./ssrfGuard.js`, and at the top of `downloadAndSave` (before the `fetch`), add:

```ts
  const guard = await assertPublicHttpUrl(url);
  if (!guard.ok) return { ok: false, error: 'fetch_failed' };
```

(Reusing the existing `'fetch_failed'` error keeps the route's response contract unchanged and avoids leaking *why* the fetch was refused.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/lib/ssrfGuard.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/integrations/ssrfGuard.ts lib/integrations/image-storage.ts tests/lib/ssrfGuard.test.ts
git commit -m "fix(web): block SSRF to private hosts in image download (audit #6)"
```

---

### Task 7: Security headers + hide framework version

**Finding:** no `X-Frame-Options`/CSP, HSTS, `X-Content-Type-Options`, or `Referrer-Policy` on any response (confirmed live); `X-Powered-By` still advertises Next.js.

**Files:**
- Modify: `next.config.js`

**Interfaces:**
- Produces: every response carries the five hardening headers; `poweredByHeader: false`.

- [ ] **Step 1: Add `headers()` and disable the powered-by header**

Edit `next.config.js` — add `poweredByHeader: false` to the config object and a `headers` async function:

```js
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  pageExtensions: ['tsx', 'ts'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
```

- [ ] **Step 2: Build and verify locally**

Run: `npm run web:build && npm run web:start` (in one shell), then in another:
`curl -sI -u "$WEB_USER:$WEB_PASSWORD" http://localhost:3000/ | grep -iE 'x-frame|content-security|strict-transport|x-content-type|referrer-policy|x-powered'`
Expected: the five hardening headers present; no `x-powered-by`.

- [ ] **Step 3: Commit**

```bash
git add next.config.js
git commit -m "feat(web): add security headers and hide X-Powered-By (audit #7)"
```

---

### Task 8: Log failed auth attempts + throttle (in `authGate`)

**Finding:** no failed-auth logging anywhere; confirmed live that 8 wrong-password attempts pass with no throttle or trace, so a brute-force run is invisible.

**Files:**
- Modify: `app/lib/authGate.ts` (add the throttle to `evaluateAuth`), `middleware.ts` (log on reject)
- Test: extend `tests/app/lib/authGate.test.ts`

**Interfaces:**
- Modifies: `evaluateAuth` returns `{ action: 'reject', status: 429, headers: { 'retry-after': '60' } }` after >10 failed attempts within 60s from one `ip`. `__resetAuthGateForTest()` now clears the throttle Map. Signature unchanged.
- Logging (path + IP, never the credential) happens in `middleware.ts` on any `reject`, using the request path.

- [ ] **Step 1: Add the failing test**

Append to `tests/app/lib/authGate.test.ts`:

```ts
it('rejects 429 after >10 failures from the same IP within the window', () => {
  __resetAuthGateForTest();
  let last;
  for (let i = 0; i < 12; i++) {
    last = evaluateAuth({ authHeader: 'Basic wrong', ip: '9.9.9.9', nodeEnv: 'production', user: 'u', password: 'p' });
  }
  expect(last?.action).toBe('reject');
  if (last?.action === 'reject') expect(last.status).toBe(429);
});

it('does not throttle a different IP', () => {
  __resetAuthGateForTest();
  for (let i = 0; i < 12; i++) evaluateAuth({ authHeader: 'Basic wrong', ip: '9.9.9.9', nodeEnv: 'production', user: 'u', password: 'p' });
  const other = evaluateAuth({ authHeader: 'Basic wrong', ip: '8.8.8.8', nodeEnv: 'production', user: 'u', password: 'p' });
  if (other.action === 'reject') expect(other.status).toBe(401);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/app/lib/authGate.test.ts`
Expected: FAIL — no throttle yet (all rejects are 401).

- [ ] **Step 3: Add the throttle to `app/lib/authGate.ts`**

Add module state and use it in the wrong-credential branch (edge-safe: `Date.now`, `Map`):

```ts
const authFails = new Map<string, number[]>();

// inside evaluateAuth, replace the final `return { action: 'reject', status: 401, ... }`:
  const now = Date.now();
  const recent = (authFails.get(input.ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  authFails.set(input.ip, recent);
  if (recent.length > 10) {
    return { action: 'reject', status: 429, headers: { 'retry-after': '60' } };
  }
  return {
    action: 'reject',
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Outdoor Inventory Dashboard"' },
  };
```

And update `__resetAuthGateForTest` to clear it:

```ts
export function __resetAuthGateForTest(): void { authFails.clear(); }
```

- [ ] **Step 4: Log on reject in `middleware.ts`**

In `middleware.ts`, after computing `decision` and before returning the `NextResponse`, add (only on reject):

```ts
  if (decision.action === 'reject') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    console.warn(`[auth] ${decision.status} ip=${ip} path=${req.nextUrl.pathname}`);
  }
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/app/lib/authGate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/lib/authGate.ts middleware.ts tests/app/lib/authGate.test.ts
git commit -m "feat(web): log + throttle failed auth attempts (audit #8)"
```

---

## Phase 3 — Hygiene & scheduled work (eventually)

### Task 9: Scrub identifiers from the public repo

**Finding:** the GitHub repo is public; the real Google Sheet ID and Tom's Gmail are committed in `.env.example` + docs, and a `.gitignore` glob mismatch (`tests/fixtures/rei|amazon/*.html` vs the flat `tests/fixtures/*.html` files actually tracked) risks silently committing future real-order fixtures.

**Files:**
- Modify: `.env.example`, `docs/PLAN.md`, `docs/PRODUCT.md`, `docs/DEPLOY.md`, `CLAUDE.md`, `.gitignore`

- [ ] **Step 1: Replace real values with placeholders**

In `.env.example` set `GOOGLE_SHEET_ID=<your-sheet-id>` and `GMAIL_USER=<your-gmail-address>`. In `docs/PLAN.md`, `docs/PRODUCT.md`, `docs/DEPLOY.md` replace the literal spreadsheet ID with `<your-sheet-id>`. In `CLAUDE.md` replace the literal Gmail with `<owner-email>`. (These are not bearer credentials — reads still require the OAuth refresh token — so no history rewrite is needed; just stop advertising the exact targets.)

- [ ] **Step 2: Fix the fixture ignore glob**

In `.gitignore`, change the fixture rules to also cover the flat layout, e.g. add `tests/fixtures/*.html` alongside the existing subdirectory patterns (or convert to an explicit allowlist of the fixtures that are intentionally committed). Confirm the currently-tracked fixtures are still intended to be committed with `git ls-files tests/fixtures/`.

- [ ] **Step 3: Manual out-of-band check (document, don't automate)**

Note in the commit body: confirm in the Google Sheets UI that the sheet is shared to the owner account only (not "anyone with the link").

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/PLAN.md docs/PRODUCT.md docs/DEPLOY.md CLAUDE.md .gitignore
git commit -m "chore: scrub sheet ID + email from public repo, fix fixture ignore glob (audit #9)"
```

> **Note:** modifying `CLAUDE.md`, `PLAN.md`, `DECISIONS.md` requires Tom's explicit confirmation per project rules — get sign-off before committing this task.

---

### Task 10: Constant-time credential comparison (in `authGate`)

**Finding:** the credential compare uses `===` (not constant-time). Low real-world risk over the internet, but cheap to close. After Task 1 this lives in `app/lib/authGate.ts`, not `middleware.ts`.

**Files:**
- Modify: `app/lib/authGate.ts`
- Test: extend `tests/app/lib/authGate.test.ts` (the existing match/mismatch cases already cover behavior; add one explicit case)

- [ ] **Step 1: Add a behavior test (guards against a broken compare)**

Append to `tests/app/lib/authGate.test.ts`:

```ts
it('still passes a correct header and rejects a same-length wrong one', () => {
  __resetAuthGateForTest();
  const ok = `Basic ${btoa('u:p')}`;
  expect(evaluateAuth({ authHeader: ok, ip: '1.2.3.4', nodeEnv: 'production', user: 'u', password: 'p' }).action).toBe('pass');
  const wrongSameLen = ok.slice(0, -1) + (ok.at(-1) === 'A' ? 'B' : 'A');
  expect(evaluateAuth({ authHeader: wrongSameLen, ip: '1.2.3.4', nodeEnv: 'production', user: 'u', password: 'p' }).action).toBe('reject');
});
```

- [ ] **Step 2: Replace `===` with a constant-time compare in `app/lib/authGate.ts`**

Edge-safe (no Node `crypto.timingSafeEqual`); fixed-length XOR over the Base64 strings:

```ts
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// replace: if (authHeader !== null && authHeader === expected) return { action: 'pass' };
// with:    if (authHeader !== null && timingSafeEqual(authHeader, expected)) return { action: 'pass' };
```

- [ ] **Step 3: Verify tests still pass**

Run: `npx vitest run tests/app/lib/authGate.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/lib/authGate.ts tests/app/lib/authGate.test.ts
git commit -m "fix(web): constant-time credential comparison (audit #10)"
```

---

### Task 11: Schedule the Next.js 14 → 15 upgrade (planning task, not a code change here)

**Finding:** `next@14.2.35` carries core SSRF/DoS advisories with no 14.x fix; only 15.5.x patches them. This is a real migration, out of scope for a one-line bump.

- [ ] **Step 1:** Create a tracking note in `DECISIONS.md` (with Tom's sign-off) recording that the app is pinned on Next 14 with the known-unpatched advisories, that the feature surface (no `next/image`, no Server Actions, no i18n) narrows applicability, and that a 15.x migration is scheduled. Do NOT attempt the upgrade inside this security plan — it needs its own plan + full regression pass.

- [ ] **Step 2:** Commit the note: `git commit -m "docs: record Next 14→15 upgrade as tracked security debt (audit #11)"`

---

### Task 12: Replace or wrap `node-telegram-bot-api` (separate follow-up)

**Finding:** `node-telegram-bot-api@0.66.0` pulls the deprecated `request`/`form-data` chain (2 criticals). Bot fetch targets are Telegram-controlled, so exploitability is low; treat as dependency-health debt.

- [ ] **Step 1:** File this as its own plan (evaluate `telegraf` vs `grammy`, port the `apps/bot` long-polling loop + `authorizedChatIds` gate + photo download). Out of scope for this security plan beyond recording it in `DECISIONS.md` with Tom's sign-off.

---

## Phase 4 — Non-code confirmations (Tom, in the Railway/Google dashboards)

These cannot be verified from the repo and need Tom to check directly. Capture the outcomes in `DECISIONS.md`.

- [ ] **Networking:** confirm only the `web` service has Public Networking / a generated domain; `bot`, `cron`, `camping` should be private (they have no HTTP listener).
- [ ] **Volume scope:** confirm the `web` service's `/data` mount is what's intended (it needs `/data/images` for reads/writes).
- [ ] **Sheet backups:** decide whether Google's version history is sufficient or whether to add a periodic export; there is no code-level backup today.
- [ ] **Credential rotation (optional):** during the audit a subagent's Railway CLI check briefly printed `WEB_PASSWORD` into the session transcript. It was not published anywhere, but rotate it in Railway if you want to be conservative — set the new value directly in the Railway variable store, do not paste it into chat.

---

## Not doing (with reasons)

- **IDOR on `[itemId]` routes** — single-user app, no other user's data to protect. Revisit only if multi-user access is added (at which point Tasks 5/6 + IDOR all escalate together).
- **Per-session chat isolation** — the shared `chatId='web'` buffer is consistent with the single-shared-credential trust model. Task 5 removes the XSS payoff; full isolation is only needed if the dashboard goes genuinely multi-user.
- **Magic-byte upload sniffing** — the serving route forces `Content-Type` from a validated extension, so stored-XSS via mislabeled bytes is already neutralized; defense-in-depth only.
- **git history rewrite for the sheet ID/email** — they aren't bearer secrets, so scrubbing going forward (Task 9) is sufficient; a history rewrite on a public repo isn't worth the disruption.

---

## Self-review notes

- **Spec coverage:** every audit finding #1–#11 maps to a task (Tasks 1–11); infra/dashboard items map to Phase 4; "not doing" items are explicitly justified.
- **Type consistency:** `evaluateAuth`/`AuthDecision`/`__resetAuthGateForTest` (Task 1) are extended in-place by Tasks 8 and 10 (same module `app/lib/authGate.ts`, same signature); `checkRateLimit`/`clientKey`/`overDailyBudget`/`recordSpend` (Task 2) are the exact names imported in Task 3; `tooLargeByContentLength` (Task 3) matches its test; `neutralizeFormula` (Task 4), `assertPublicHttpUrl`/`isPrivateAddress` (Task 6) are each defined where first used. No test imports `next/server` or JSX — all tested units are plain modules.
- **Ordering:** Phase 1 (fail-safe + money) is independent and lands first; Phase 2 fixes are mutually independent; Phase 3/4 are hygiene/planning.
