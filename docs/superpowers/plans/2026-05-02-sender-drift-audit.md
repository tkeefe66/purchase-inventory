# Sender-Drift Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when REI/Amazon change the senders or subject patterns of their order/shipment emails, so the ingest pipeline doesn't silently miss purchases.

**Architecture:** A weekly audit runs alongside the existing cron (Sunday morning Mountain time, inside the same Railway service). It performs two broad Gmail searches: (A) purchase-shaped subjects from any `amazon.com`/`rei.com` sender — flag any not in the allowlist; (B) purchase-keyword subjects from allowlisted senders — flag any whose subject doesn't match expected patterns. Telegram alerts only when something is flagged.

**Tech Stack:** TypeScript 5, vitest, googleapis (Gmail), node fetch (Telegram), date-fns-tz.

---

## File Structure

**New files**
- `lib/sources.ts` — single source of truth for sender allowlist, subject patterns, and helpers (`pickSource`, `senderIsAllowlisted`, `subjectMatchesExpected`, `subjectLooksLikePurchase`).
- `apps/cron/audit.ts` — exports `runAudit()`; also has a CLI `main()` so it can be invoked directly via `npm run audit`.
- `tests/sources.test.ts` — unit tests for the helpers in `lib/sources.ts`.
- `tests/cron/audit.test.ts` — tests `runAudit()` against a mocked Gmail client.

**Modified files**
- `apps/cron/pipeline.ts` — replace hardcoded `REI_SENDER` / `AMAZON_*_SENDER` constants and local `pickSource` with imports from `lib/sources.ts`. Pure refactor; no behavior change.
- `apps/cron/index.ts` — after `runPipeline`, check Mountain time day-of-week + hour; if Sunday morning, also call `runAudit`.
- `package.json` — add `"audit": "tsx apps/cron/audit.ts"` script.
- `docs/PLAN.md` — add a brief "Reliability" subsection pointing at the audit job.
- `DECISIONS.md` — append decision: weekly audit, paired with morning cron, no state, Telegram-only output.

**Not touched**
- `railway.json` — no change. Audit runs from inside the existing scheduled command.
- `lib/gmail.ts`, `lib/telegram.ts` — no change. Audit reuses existing helpers.

---

## Behavior Decisions (Locked)

- Schedule: Sunday only, morning cron tick (Mountain time hour < 12).
- Lookback window: 8 days (one day of overlap so a Sunday-edge email doesn't slip through).
- Two checks, one alert: both Check A (sender drift) and Check B (subject drift) run every audit; results combined into a single Telegram message.
- Alert threshold: any single flagged email triggers the message.
- Stay silent on clean weeks (no "✓ all good" digest).
- No state, no labels, no sheet writes — audit is purely diagnostic.

---

## Task 1: Create `lib/sources.ts` with helpers (TDD)

**Files:**
- Create: `lib/sources.ts`
- Test: `tests/sources.test.ts`

- [ ] **Step 1: Write the failing test for `senderIsAllowlisted`**

Create `tests/sources.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import {
  senderIsAllowlisted,
  pickSource,
  subjectMatchesExpected,
  subjectLooksLikePurchase,
  KNOWN_SENDERS,
  PURCHASE_KEYWORDS,
} from '../lib/sources.js';

describe('senderIsAllowlisted', () => {
  test('matches REI order sender', () => {
    expect(senderIsAllowlisted('REI <rei@notices.rei.com>')).toBe(true);
  });
  test('matches Amazon order sender', () => {
    expect(senderIsAllowlisted('"Amazon.com" <auto-confirm@amazon.com>')).toBe(true);
  });
  test('matches Amazon shipment sender', () => {
    expect(senderIsAllowlisted('Amazon Shipping <shipment-tracking@amazon.com>')).toBe(true);
  });
  test('rejects amazon promo sender', () => {
    expect(senderIsAllowlisted('Amazon <store-news@amazon.com>')).toBe(false);
  });
  test('rejects unrelated sender', () => {
    expect(senderIsAllowlisted('hello@example.com')).toBe(false);
  });
  test('is case-insensitive', () => {
    expect(senderIsAllowlisted('REI@NOTICES.REI.COM')).toBe(true);
  });
});

describe('pickSource', () => {
  test('returns REI for the REI notices sender', () => {
    expect(pickSource('rei@notices.rei.com')).toBe('REI');
  });
  test('returns Amazon for both auto-confirm and shipment-tracking', () => {
    expect(pickSource('auto-confirm@amazon.com')).toBe('Amazon');
    expect(pickSource('shipment-tracking@amazon.com')).toBe('Amazon');
  });
  test('returns null for non-allowlisted senders', () => {
    expect(pickSource('store-news@amazon.com')).toBeNull();
  });
});

describe('subjectMatchesExpected', () => {
  test('matches Amazon "Ordered:" pattern for amazon-order role', () => {
    expect(subjectMatchesExpected('amazon-order', 'Ordered: "USA Gear Camera Sleeve..."')).toBe(true);
  });
  test('matches Amazon "Shipped:" pattern for amazon-shipment role', () => {
    expect(subjectMatchesExpected('amazon-shipment', 'Shipped: "USA Gear Camera Sleeve..."')).toBe(true);
  });
  test('matches Amazon "Out for delivery:" pattern for amazon-shipment', () => {
    expect(subjectMatchesExpected('amazon-shipment', 'Out for delivery: "Foo"')).toBe(true);
  });
  test('matches REI order pattern', () => {
    expect(subjectMatchesExpected('rei-order', 'Your REI order #1234567 has been received')).toBe(true);
  });
  test('matches REI shipment pattern', () => {
    expect(subjectMatchesExpected('rei-order', 'Your REI order #1234567 has shipped')).toBe(true);
  });
  test('returns false for unrelated subject from allowlisted sender', () => {
    expect(subjectMatchesExpected('amazon-order', 'Action required: update your payment method')).toBe(false);
  });
});

describe('subjectLooksLikePurchase', () => {
  test('flags subjects containing purchase keywords', () => {
    expect(subjectLooksLikePurchase('Your order is on the way')).toBe(true);
    expect(subjectLooksLikePurchase('Shipping update for your purchase')).toBe(true);
    expect(subjectLooksLikePurchase('Delivered today')).toBe(true);
  });
  test('rejects subjects without purchase keywords', () => {
    expect(subjectLooksLikePurchase('Weekend deals just for you')).toBe(false);
    expect(subjectLooksLikePurchase('Update your account preferences')).toBe(false);
  });
});

describe('KNOWN_SENDERS / PURCHASE_KEYWORDS', () => {
  test('exports a non-empty allowlist', () => {
    expect(KNOWN_SENDERS.length).toBeGreaterThan(0);
  });
  test('exports a non-empty keyword list', () => {
    expect(PURCHASE_KEYWORDS.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/sources.test.ts`
Expected: FAIL with "Cannot find module '../lib/sources.js'"

- [ ] **Step 3: Implement `lib/sources.ts`**

Create `lib/sources.ts`:

```ts
import type { Source } from './types.js';

export type SenderRole = 'rei-order' | 'amazon-order' | 'amazon-shipment';

export interface KnownSender {
  email: string;
  role: SenderRole;
  source: Source;
}

export const KNOWN_SENDERS: readonly KnownSender[] = [
  { email: 'rei@notices.rei.com', role: 'rei-order', source: 'REI' },
  { email: 'auto-confirm@amazon.com', role: 'amazon-order', source: 'Amazon' },
  { email: 'shipment-tracking@amazon.com', role: 'amazon-shipment', source: 'Amazon' },
];

export const PURCHASE_KEYWORDS: readonly string[] = [
  'order',
  'ordered',
  'ship',
  'shipped',
  'shipping',
  'deliver',
  'delivered',
  'delivery',
  'purchase',
  'arriving',
  'arrived',
];

const EXPECTED_SUBJECT_PATTERNS: Record<SenderRole, RegExp[]> = {
  'amazon-order': [
    /^Ordered:/i,
    /^Your Amazon\.com order/i,
    /^Order confirmation/i,
  ],
  'amazon-shipment': [
    /^Shipped:/i,
    /^Out for delivery:/i,
    /^Delivered:/i,
    /^Arriving today:/i,
    /^Arriving (tomorrow|on)/i,
  ],
  'rei-order': [
    /Your REI .*order/i,
    /has shipped/i,
    /has been (received|delivered|placed)/i,
    /order confirmation/i,
  ],
};

export function senderIsAllowlisted(from: string): boolean {
  const lc = from.toLowerCase();
  return KNOWN_SENDERS.some((s) => lc.includes(s.email));
}

export function pickSource(from: string): Source | null {
  const lc = from.toLowerCase();
  const match = KNOWN_SENDERS.find((s) => lc.includes(s.email));
  return match ? match.source : null;
}

export function pickRole(from: string): SenderRole | null {
  const lc = from.toLowerCase();
  const match = KNOWN_SENDERS.find((s) => lc.includes(s.email));
  return match ? match.role : null;
}

export function subjectMatchesExpected(role: SenderRole, subject: string): boolean {
  return EXPECTED_SUBJECT_PATTERNS[role].some((re) => re.test(subject));
}

export function subjectLooksLikePurchase(subject: string): boolean {
  const lc = subject.toLowerCase();
  return PURCHASE_KEYWORDS.some((kw) => lc.includes(kw));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/sources.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/sources.ts tests/sources.test.ts
git commit -m "feat: extract sender allowlist + subject patterns to lib/sources.ts"
```

---

## Task 2: Refactor `pipeline.ts` to use `lib/sources.ts`

**Files:**
- Modify: `apps/cron/pipeline.ts`

This is a pure refactor. No new tests; existing tests must still pass.

- [ ] **Step 1: Edit `apps/cron/pipeline.ts` — replace hardcoded sender constants and local `pickSource`**

In `apps/cron/pipeline.ts`:

1. Add to imports near the top (around line 14):

```ts
import {
  pickSource,
  KNOWN_SENDERS,
} from '../../lib/sources.js';
```

2. Delete the three hardcoded constants (currently lines 30-32):

```ts
const REI_SENDER = 'rei@notices.rei.com';
const AMAZON_ORDER_SENDER = 'auto-confirm@amazon.com';
const AMAZON_SHIPMENT_SENDER = 'shipment-tracking@amazon.com';
```

3. Delete the local `pickSource` function (currently lines 246-250).

4. Update `buildQuery` to derive the sender list from `KNOWN_SENDERS` (currently around line 268):

```ts
function buildQuery(opts: PipelineOptions): string {
  const senders = `from:(${KNOWN_SENDERS.map((s) => s.email).join(' OR ')})`;
  if (opts.reprocessSince) {
    return `${senders} after:${gmailDate(opts.reprocessSince)}`;
  }
  const afterPart = opts.ingestAfterDate
    ? ` after:${gmailDate(opts.ingestAfterDate)}`
    : ' newer_than:30d';
  return `${senders} -label:${PROCESSED_LABEL}${afterPart}`;
}
```

- [ ] **Step 2: Run typecheck and full test suite**

Run: `npm run typecheck && npm run test`
Expected: PASS — both succeed, no behavior change.

- [ ] **Step 3: Commit**

```bash
git add apps/cron/pipeline.ts
git commit -m "refactor: pipeline.ts uses shared KNOWN_SENDERS + pickSource"
```

---

## Task 3: Implement audit logic (TDD)

**Files:**
- Create: `apps/cron/audit.ts`
- Create: `tests/cron/audit.test.ts`

The audit returns a structured result. The Gmail/Telegram clients are passed in so we can mock them in tests.

- [ ] **Step 1: Write failing tests for `runAudit`**

Create `tests/cron/audit.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
import { runAudit, type AuditResult } from '../../apps/cron/audit.js';
import type { GmailClient } from '../../lib/gmail.js';
import type { gmail_v1 } from 'googleapis';

function fakeGmailMessage(id: string, from: string, subject: string): gmail_v1.Schema$Message {
  return {
    id,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: new Date().toUTCString() },
      ],
    },
  };
}

function makeFakeGmail(messages: gmail_v1.Schema$Message[]): GmailClient {
  return {
    users: {
      messages: {
        list: vi.fn().mockResolvedValue({
          data: { messages: messages.map((m) => ({ id: m.id })) },
        }),
        get: vi.fn().mockImplementation(({ id }: { id: string }) => {
          const m = messages.find((mm) => mm.id === id);
          return Promise.resolve({ data: m });
        }),
      },
    },
  } as unknown as GmailClient;
}

describe('runAudit', () => {
  test('returns clean result when no suspicious emails', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('a', 'auto-confirm@amazon.com', 'Ordered: "Foo"'),
      fakeGmailMessage('b', 'shipment-tracking@amazon.com', 'Shipped: "Foo"'),
      fakeGmailMessage('c', 'rei@notices.rei.com', 'Your REI order #123 has shipped'),
    ]);
    const result: AuditResult = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.senderDrift).toEqual([]);
    expect(result.subjectDrift).toEqual([]);
    expect(result.clean).toBe(true);
  });

  test('flags purchase-shaped subjects from non-allowlisted senders (Check A)', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('a', 'auto-confirm@amazon.com', 'Ordered: "Foo"'),
      fakeGmailMessage('x', 'orders-confirm@amazon.com', 'Ordered: "Bar"'),
    ]);
    const result = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.senderDrift).toHaveLength(1);
    expect(result.senderDrift[0]).toMatchObject({
      from: 'orders-confirm@amazon.com',
      subject: 'Ordered: "Bar"',
    });
    expect(result.subjectDrift).toEqual([]);
    expect(result.clean).toBe(false);
  });

  test('flags purchase-keyword subjects from allowlisted senders that do not match expected patterns (Check B)', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('a', 'auto-confirm@amazon.com', 'Ordered: "Foo"'),
      fakeGmailMessage('y', 'auto-confirm@amazon.com', 'Pre-ordered today: "Bar"'),
    ]);
    const result = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.subjectDrift).toHaveLength(1);
    expect(result.subjectDrift[0]).toMatchObject({
      from: 'auto-confirm@amazon.com',
      subject: 'Pre-ordered today: "Bar"',
    });
    expect(result.senderDrift).toEqual([]);
    expect(result.clean).toBe(false);
  });

  test('does not flag non-purchase subjects from allowlisted senders (Check B noise reduction)', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('z', 'auto-confirm@amazon.com', 'Update your account preferences'),
    ]);
    const result = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.subjectDrift).toEqual([]);
    expect(result.clean).toBe(true);
  });

  test('caps the number of flagged samples returned per check (max 10)', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      fakeGmailMessage(`m${i}`, 'orders-confirm@amazon.com', `Ordered: "Item ${i}"`),
    );
    const result = await runAudit({ gmail: makeFakeGmail(many), lookbackDays: 8 });
    expect(result.senderDrift.length).toBeLessThanOrEqual(10);
    expect(result.totals.senderDrift).toBe(25);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/cron/audit.test.ts`
Expected: FAIL with "Cannot find module '../../apps/cron/audit.js'"

- [ ] **Step 3: Implement `apps/cron/audit.ts`**

Create `apps/cron/audit.ts`:

```ts
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { formatInTimeZone } from 'date-fns-tz';
import {
  createGmailClient,
  getHeader,
  getMessage,
  listMessages,
  type GmailClient,
} from '../../lib/gmail.js';
import {
  KNOWN_SENDERS,
  pickRole,
  senderIsAllowlisted,
  subjectLooksLikePurchase,
  subjectMatchesExpected,
} from '../../lib/sources.js';
import { sendMessage } from '../../lib/telegram.js';

const SAMPLE_CAP = 10;
const PURCHASE_DOMAINS = ['amazon.com', 'rei.com'];

export interface AuditFlag {
  messageId: string;
  from: string;
  subject: string;
}

export interface AuditResult {
  startedAt: string;
  endedAt: string;
  lookbackDays: number;
  senderDrift: AuditFlag[];
  subjectDrift: AuditFlag[];
  totals: { senderDrift: number; subjectDrift: number };
  clean: boolean;
}

export interface RunAuditOptions {
  gmail: GmailClient;
  lookbackDays: number;
}

export async function runAudit(opts: RunAuditOptions): Promise<AuditResult> {
  const startedAt = new Date().toISOString();
  const senderDrift: AuditFlag[] = [];
  const subjectDrift: AuditFlag[] = [];
  let senderDriftTotal = 0;
  let subjectDriftTotal = 0;

  const query = buildAuditQuery(opts.lookbackDays);
  const ids = await listMessages(opts.gmail, { query, maxResults: 500 });

  for (const id of ids) {
    const msg = await getMessage(opts.gmail, id);
    const from = (getHeader(msg, 'From') ?? '').toLowerCase();
    const subject = getHeader(msg, 'Subject') ?? '';

    if (senderIsAllowlisted(from)) {
      const role = pickRole(from);
      if (
        role &&
        subjectLooksLikePurchase(subject) &&
        !subjectMatchesExpected(role, subject)
      ) {
        subjectDriftTotal++;
        if (subjectDrift.length < SAMPLE_CAP) {
          subjectDrift.push({ messageId: id, from, subject });
        }
      }
    } else if (subjectLooksLikePurchase(subject)) {
      senderDriftTotal++;
      if (senderDrift.length < SAMPLE_CAP) {
        senderDrift.push({ messageId: id, from, subject });
      }
    }
  }

  return {
    startedAt,
    endedAt: new Date().toISOString(),
    lookbackDays: opts.lookbackDays,
    senderDrift,
    subjectDrift,
    totals: { senderDrift: senderDriftTotal, subjectDrift: subjectDriftTotal },
    clean: senderDriftTotal === 0 && subjectDriftTotal === 0,
  };
}

function buildAuditQuery(lookbackDays: number): string {
  const senderClause = `from:(${PURCHASE_DOMAINS.join(' OR ')})`;
  return `${senderClause} newer_than:${lookbackDays}d`;
}

export function formatAuditDigest(r: AuditResult): string {
  const tz = process.env.TZ ?? 'America/Denver';
  const when = formatInTimeZone(new Date(r.startedAt), tz, 'EEE MMM d, h:mm a zzz');
  const lines: string[] = [];
  lines.push(`🔎 Sender-drift audit @ ${when}`);
  lines.push(
    `Allowlist: ${KNOWN_SENDERS.map((s) => s.email).join(', ')}`,
  );

  if (r.senderDrift.length > 0) {
    lines.push('');
    lines.push(
      `⚠️ Check A — purchase-shaped subjects from NON-allowlisted senders (${r.totals.senderDrift} total, showing ${r.senderDrift.length}):`,
    );
    for (const f of r.senderDrift) {
      lines.push(`  • ${f.from} — ${f.subject.slice(0, 80)}`);
    }
  }

  if (r.subjectDrift.length > 0) {
    lines.push('');
    lines.push(
      `⚠️ Check B — allowlisted senders using NEW subject patterns (${r.totals.subjectDrift} total, showing ${r.subjectDrift.length}):`,
    );
    for (const f of r.subjectDrift) {
      lines.push(`  • ${f.from} — ${f.subject.slice(0, 80)}`);
    }
  }

  return lines.join('\n');
}

interface AuditEnv {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  telegramBotToken: string | undefined;
  telegramChatId: string | undefined;
}

function readEnv(): AuditEnv {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    console.error(`✗ Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: refreshToken!,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
  };
}

async function main(): Promise<void> {
  const env = readEnv();
  const gmail = createGmailClient({
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    refreshToken: env.refreshToken,
  });
  const result = await runAudit({ gmail, lookbackDays: 8 });
  console.log(JSON.stringify(result, null, 2));

  if (!result.clean && env.telegramBotToken && env.telegramChatId) {
    await sendMessage(
      { botToken: env.telegramBotToken },
      { chat_id: env.telegramChatId, text: formatAuditDigest(result) },
    );
    console.log('✓ Telegram alert sent');
  } else if (result.clean) {
    console.log('✓ Audit clean — no Telegram alert sent');
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error('✗ Audit fatal:', err instanceof Error ? err.stack ?? err.message : err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/cron/audit.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Run full test suite + typecheck to verify nothing broke**

Run: `npm run typecheck && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/cron/audit.ts tests/cron/audit.test.ts
git commit -m "feat: weekly sender-drift audit with two-check Telegram alerting"
```

---

## Task 4: Wire audit into the cron entrypoint

**Files:**
- Modify: `apps/cron/index.ts`

The audit fires after the regular pipeline, only on Sunday morning Mountain time. Failures in the audit must not crash the cron — wrap in try/catch.

- [ ] **Step 1: Edit `apps/cron/index.ts` to call `runAudit` conditionally**

In `apps/cron/index.ts`:

1. Add import near the top (around line 2):

```ts
import { formatInTimeZone } from 'date-fns-tz';
import { createGmailClient } from '../../lib/gmail.js';
import { sendMessage } from '../../lib/telegram.js';
import { runAudit, formatAuditDigest } from './audit.js';
```

2. After `const result = await runPipeline(opts);` (currently line 94), insert:

```ts
  if (shouldRunWeeklyAudit()) {
    try {
      console.log('\n=== Running weekly sender-drift audit ===');
      const gmail = createGmailClient({
        clientId: env.clientId,
        clientSecret: env.clientSecret,
        refreshToken: env.refreshToken,
      });
      const audit = await runAudit({ gmail, lookbackDays: 8 });
      console.log(JSON.stringify(audit, null, 2));
      if (!audit.clean && env.telegramBotToken && env.telegramChatId) {
        await sendMessage(
          { botToken: env.telegramBotToken },
          { chat_id: env.telegramChatId, text: formatAuditDigest(audit) },
        );
        console.log('✓ Audit Telegram alert sent');
      } else if (audit.clean) {
        console.log('✓ Audit clean — no alert sent');
      }
    } catch (err) {
      console.error('✗ Weekly audit failed (non-fatal):', err instanceof Error ? err.message : err);
    }
  }
```

3. Add the helper at the bottom of the file (before the final `main().catch(...)` line):

```ts
function shouldRunWeeklyAudit(): boolean {
  const tz = process.env.TZ ?? 'America/Denver';
  const dayOfWeek = formatInTimeZone(new Date(), tz, 'EEEE');
  const hour = parseInt(formatInTimeZone(new Date(), tz, 'H'), 10);
  return dayOfWeek === 'Sunday' && hour < 12;
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Smoke-test locally with dry-run (optional but recommended)**

Run: `npm run cron:dry`
Expected: Pipeline runs as before. Audit only triggers if today happens to be Sunday morning Mountain — so on most days you'll just see the normal pipeline output, which confirms the wiring didn't break anything.

- [ ] **Step 4: Commit**

```bash
git add apps/cron/index.ts
git commit -m "feat: cron runs weekly audit on Sunday morning Mountain time"
```

---

## Task 5: Add `audit` npm script for manual runs

**Files:**
- Modify: `package.json`

Lets you run the audit on-demand from the CLI (handy for testing the alert path before Sunday).

- [ ] **Step 1: Edit `package.json` to add the script**

In the `"scripts"` section of `package.json`, add after the `"cron:dry"` entry:

```json
    "audit": "tsx apps/cron/audit.ts",
```

- [ ] **Step 2: Verify the script runs (don't actually invoke against real Gmail unless you want to)**

Run: `npm run audit -- --help 2>&1 | head -5` (won't really show help, just verifies the script resolves)
Expected: tsx loads `apps/cron/audit.ts` without error.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add npm run audit for manual sender-drift checks"
```

---

## Task 6: Document in PLAN.md and DECISIONS.md

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `DECISIONS.md`

- [ ] **Step 1: Append a Reliability section to `docs/PLAN.md`**

Find a sensible spot (e.g., after the main phase list) and add:

```markdown
## Reliability

### Sender-drift audit (shipped 2026-05-02)

A weekly Gmail audit runs every Sunday morning Mountain time, paired with the existing 6am cron tick. It performs two broad searches across `amazon.com` / `rei.com` senders to detect:

- **Check A — Sender drift:** purchase-shaped subjects from senders NOT in the ingest allowlist.
- **Check B — Subject drift:** purchase-keyword subjects from allowlisted senders that do not match the expected subject patterns.

Telegram alerts only fire when at least one email is flagged. The audit reads no state, writes nothing, applies no labels. Code: `apps/cron/audit.ts`. Allowlist + patterns: `lib/sources.ts`. Manual run: `npm run audit`.
```

- [ ] **Step 2: Append a decision entry to `DECISIONS.md`**

Add to the bottom of `DECISIONS.md`:

```markdown
## 2026-05-02 — Sender-drift audit

**Decision:** Add a weekly Gmail audit that runs alongside the existing Sunday-morning cron tick. Two checks (sender drift, subject drift). Telegram-only output, fires only when something is flagged. No state.

**Why:** Hardcoded sender allowlist (`rei@notices.rei.com`, `auto-confirm@amazon.com`, `shipment-tracking@amazon.com`) means a silent under-count if Amazon or REI ever change senders or subject conventions. Failure mode is invisible without an external check.

**Why not broader filter:** Loosening the main pipeline to `from:amazon.com` would pull in promo / return / account email and require new noise-filtering. The audit gives us drift detection without changing the ingest path.

**Why no state:** Keeps the audit a pure function — easy to test, easy to reason about. Sample cap (10 per check) prevents Telegram spam if drift is widespread.
```

- [ ] **Step 3: Commit**

```bash
git add docs/PLAN.md DECISIONS.md
git commit -m "docs: record sender-drift audit in PLAN + DECISIONS"
```

---

## Verification checklist (run before declaring done)

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes (all suites, including the two new ones)
- [ ] `npm run lint` passes
- [ ] `npm run cron:dry` runs successfully end-to-end (audit will silently skip on non-Sunday-morning runs)
- [ ] Manually invoke `npm run audit` against real Gmail and confirm:
  - JSON result is printed
  - On a clean inbox, no Telegram message is sent
  - Sample at least one purposeful flag (e.g., temporarily lower the keyword bar) to verify the Telegram alert format renders correctly, then revert
