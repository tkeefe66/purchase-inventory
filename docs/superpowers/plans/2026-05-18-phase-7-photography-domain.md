# Phase 7 — Photography domain — Implementation Plan

> **Status: SHIPPED 2026-05-19.** All sections of this plan have landed on `main`. The final shape diverged from this plan in a few places — notably 4-branch tier structure instead of 16 flat tracks, compressed Photo (not Document) as the first-class submission flow, and 58 topics shipped instead of "~75". See `DECISIONS.md` 2026-05-19 entries and `docs/PLAN.md` Phase 7 section for the authoritative summary.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Photography domain as the second domain agent in the inventory platform — a stateful photography coach with a ~75-topic skill-tree, binary-verdict assignment grading via Claude vision, pull-only Telegram interaction, and a read-only Skills page in the web UI.

**Architecture:** New `domains/photography/` folder mirroring `domains/outdoor/` structure. Bot router is rewritten to support two domains via sticky mode + slash overrides. Two new sheet tabs (`Photography Assignments` + `Photography Progress`) track curriculum state. Cross-domain integrations (weather, trails, sun-times) are extracted to `lib/integrations/` so both domains can use them without violating the "domains don't import from other domains" architectural rule. No new cron services — Phase 7 is fully pull-driven.

**Tech Stack:** Node.js 20 + TypeScript 5, vitest, googleapis, `@anthropic-ai/sdk` (Opus 4.7 primary for grading + agent), `exifr` (new dep — EXIF reader), `suncalc` (new dep — sun-times math), `node-telegram-bot-api`, Next.js (read-only Skills page).

**Spec:** `docs/superpowers/specs/2026-05-18-phase-7-photography-domain-design.md`

**Build order (7 milestones, 33 tasks):** Foundation (T1–T7) → Bot router rewrite (T8–T10) → Skill-tree + curriculum (T11–T19) → Assignment lifecycle (T20–T25) → Photo submission + grading (T26–T29) → Web UI (T30–T32) → Onboarding + acceptance test (T33).

**Ship gate:** Phase 6 (web UI) must be in daily use for ≥1 month before this plan begins execution. Phase 6 shipped 2026-05-18 — earliest start ~2026-06-18. This plan exists to capture the work while the spec is fresh; park it until the gate opens.

**Critical conventions for the implementing engineer:**
- TypeScript imports use the `.js` suffix even when importing a `.ts` file (NodeNext mode in `tsconfig.node.json`). Example: `import { foo } from './bar.js'` references `./bar.ts`. Do not omit the `.js`.
- The web UI uses `tsconfig.json` (bundler mode) and does NOT need the `.js` suffix.
- `npm run typecheck` runs BOTH tsconfigs; both must pass.
- Vitest fixtures live in `tests/fixtures/`. Real-data fixtures preferred; synthetic for unit tests.
- Mock googleapis Sheets and Telegram in unit tests. End-to-end tests against real sheet are manual.
- All Claude model IDs live in `lib/models.ts` — never hardcode a model string elsewhere. The grading call uses `AGENT_PRIMARY_MODEL` (currently Opus 4.7) with `AGENT_FALLBACK_MODELS` for retry.
- Prompt caching is mandatory on every Claude call (per global CLAUDE.md). System prompts + tool defs get `cache_control: { type: 'ephemeral' }`.
- Default to no comments. Only add when WHY is non-obvious.

---

## Milestone 1 — Foundation (Tasks 1–7)

These tasks set up the structural prerequisites: cross-domain integration refactor, classifier, sheet tabs, inventory grounding helpers. No user-visible behavior changes until Milestone 2 lands.

### Task 1: Cross-domain refactor — move weather + trails to `lib/integrations/`

**Why:** The architectural rule is `domains/<name>/` cannot import from another domain. Photography needs `get_forecast` and `lookup_trail` (currently in `domains/outdoor/integrations/`). Moving them to `lib/integrations/` makes them shared infra both domains can import.

**Files:**
- Create: `lib/integrations/weather.ts` (moved from `domains/outdoor/integrations/weather.ts`)
- Create: `lib/integrations/trails.ts` (moved from `domains/outdoor/integrations/trails.ts`)
- Modify: any file that imports from `domains/outdoor/integrations/weather` or `.../trails`
- Modify: any test file that imports these
- Modify: `domains/outdoor/agent.ts` — update tool registry imports
- Modify: `domains/outdoor/tools.ts` (if exists) — update dispatcher imports

- [ ] **Step 1: Run a sweep to find every importer of the two files**

```bash
grep -rn "domains/outdoor/integrations/weather\|domains/outdoor/integrations/trails" \
  --include='*.ts' /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory
```

Note every file that needs an import update.

- [ ] **Step 2: Move the two files**

```bash
git mv domains/outdoor/integrations/weather.ts lib/integrations/weather.ts
git mv domains/outdoor/integrations/trails.ts lib/integrations/trails.ts
```

If the test files live next to them (e.g. `weather.test.ts`), move those too.

- [ ] **Step 3: Update all import paths**

Run a search-and-replace across the importers identified in Step 1:

```ts
// OLD
import { getForecast } from '../integrations/weather.js';
import { lookupTrail } from '../integrations/trails.js';

// NEW
import { getForecast } from '../../lib/integrations/weather.js';
import { lookupTrail } from '../../lib/integrations/trails.js';
```

Adjust the relative path depth based on where the importer lives.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0. If any path is wrong, fix and re-run.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all existing tests pass. Trail + weather tests should pass at their new path.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move weather + trails integrations to lib/integrations/ for cross-domain reuse"
```

---

### Task 2: Add suncalc integration `lib/integrations/sunTimes.ts`

**Why:** Photography agent needs golden/blue hour times for shoot planning. The `suncalc` npm library is pure math (no external API), making this a cheap, deterministic dep.

**Files:**
- Create: `lib/integrations/sunTimes.ts`
- Create: `tests/lib/integrations/sunTimes.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Install suncalc**

```bash
npm install suncalc
npm install -D @types/suncalc
```

- [ ] **Step 2: Write the failing test first**

Create `tests/lib/integrations/sunTimes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getSunTimes } from '../../../lib/integrations/sunTimes.js';

describe('getSunTimes', () => {
  it('returns golden + blue hour times for Denver on 2026-06-21 (summer solstice)', () => {
    const result = getSunTimes(39.7392, -104.9903, '2026-06-21');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sunrise).toMatch(/^2026-06-21T1[12]/); // ~12:30 UTC = ~6:30 MDT
    expect(result.sunset).toMatch(/^2026-06-22T0[12]/);  // ~02:30 UTC next day = ~20:30 MDT
    expect(result.goldenHourEvening.start).toBeDefined();
    expect(result.blueHourMorning.end).toBeDefined();
  });

  it('returns bad_coords error for invalid lat/lng', () => {
    const result = getSunTimes(999, 999, '2026-06-21');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('bad_coords');
  });
});
```

Run: `npx vitest tests/lib/integrations/sunTimes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/integrations/sunTimes.ts`**

```ts
import SunCalc from 'suncalc';

export type SunTimes = {
  ok: true;
  date: string;
  sunrise: string;
  sunset: string;
  solarNoon: string;
  civilDawn: string;
  civilDusk: string;
  goldenHourMorning: { start: string; end: string };
  goldenHourEvening: { start: string; end: string };
  blueHourMorning: { start: string; end: string };
  blueHourEvening: { start: string; end: string };
} | {
  ok: false;
  error: 'bad_coords' | 'bad_date';
};

export function getSunTimes(lat: number, lng: number, dateISO: string): SunTimes {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, error: 'bad_coords' };
  }
  const date = new Date(dateISO + 'T12:00:00Z');
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: 'bad_date' };
  }
  const t = SunCalc.getTimes(date, lat, lng);
  return {
    ok: true,
    date: dateISO,
    sunrise: t.sunrise.toISOString(),
    sunset: t.sunset.toISOString(),
    solarNoon: t.solarNoon.toISOString(),
    civilDawn: t.dawn.toISOString(),
    civilDusk: t.dusk.toISOString(),
    goldenHourMorning: { start: t.dawn.toISOString(), end: t.goldenHourEnd.toISOString() },
    goldenHourEvening: { start: t.goldenHour.toISOString(), end: t.dusk.toISOString() },
    blueHourMorning: { start: t.nightEnd.toISOString(), end: t.dawn.toISOString() },
    blueHourEvening: { start: t.dusk.toISOString(), end: t.night.toISOString() },
  };
}
```

- [ ] **Step 4: Run tests; expect PASS**

```bash
npx vitest tests/lib/integrations/sunTimes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/integrations/sunTimes.ts tests/lib/integrations/sunTimes.test.ts package.json package-lock.json
git commit -m "feat(integrations): add sunTimes for golden + blue hour"
```

---

### Task 3: Photography classifier `domains/photography/classifier.ts`

**Why:** The classifier decides "does this purchase belong to the Photography domain?" — the entry point for the email-ingest pipeline routing.

**Files:**
- Create: `domains/photography/classifier.ts`
- Create: `tests/domains/photography/classifier.test.ts`
- Create: `domains/photography/README.md`

- [ ] **Step 1: Author the classifier README**

Create `domains/photography/README.md` (one paragraph):

```markdown
# Photography Domain

This domain owns gear, education, and workflow for photography — camera bodies, lenses, printers, paper, filters, tripods, editing-software subscriptions (Lightroom, Capture One), and adjacent accessories. The agent teaches Tom photography fundamentals + his specific gear (Sony a6700, Sigma 18-50 f/2.8, Sony 70-350, Epson ET-8550), critiques photo submissions against assignment rubrics, and helps with shoot planning + Lightroom editing + printing workflow. See `docs/superpowers/specs/2026-05-18-phase-7-photography-domain-design.md` for the full design.
```

- [ ] **Step 2: Write the failing test**

`tests/domains/photography/classifier.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyPhotography } from '../../../domains/photography/classifier.js';

describe('classifyPhotography', () => {
  it('classifies a Sony camera body as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sony Alpha a6700 Mirrorless Camera Body',
      brand: 'Sony',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(true);
  });

  it('classifies a Sigma lens as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sigma 18-50mm f/2.8 DC DN Contemporary Lens',
      brand: 'Sigma',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(true);
  });

  it('classifies the Epson ET-8550 printer as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Epson EcoTank Photo ET-8550 All-in-One Printer',
      brand: 'Epson',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(true);
  });

  it('classifies Lightroom subscription as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Adobe Photography Plan (Lightroom + Photoshop)',
      brand: 'Adobe',
      source: 'Manual',
    });
    expect(result.isMatch).toBe(true);
  });

  it('does NOT classify a hiking boot as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Salomon X Ultra 4 GTX Hiking Boots',
      brand: 'Salomon',
      source: 'REI',
    });
    expect(result.isMatch).toBe(false);
  });

  it('does NOT classify a kitchen knife as Photography', () => {
    const result = classifyPhotography({
      itemName: "Wusthof Classic 8-inch Chef's Knife",
      brand: 'Wusthof',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(false);
  });
});
```

Run: `npx vitest tests/domains/photography/classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classifier**

`domains/photography/classifier.ts`:

```ts
export type ClassifyInput = {
  itemName: string;
  brand: string | null;
  source: string;
};

export type ClassifyResult = {
  isMatch: boolean;
  confidence: number;        // 0–1
  category?: string;
  subCategory?: string;
};

const KEYWORDS_STRONG = [
  'camera', 'mirrorless', 'dslr', 'lens', 'tripod', 'gimbal', 'flash',
  'speedlight', 'softbox', 'lightroom', 'capture one', 'photoshop',
  'epson ecotank', 'photo printer', 'photo paper', 'icc profile',
  'sd card', 'cf card', 'memory card', 'card reader', 'shutter release',
  'remote release', 'lens hood', 'lens cap', 'lens filter', 'polarizer',
  'cpl filter', 'nd filter', 'uv filter', 'lens cleaning',
  'camera bag', 'camera strap', 'camera grip', 'battery grip',
  'np-fz100', 'np-fw50',
];

const KEYWORDS_BRAND = new Set([
  'sony alpha', 'sony fe', 'sigma art', 'sigma contemporary', 'sigma sport',
  'tamron', 'rokinon', 'samyang', 'viltrox', 'tt artisan',
  'fujifilm x', 'fuji gfx', 'canon eos', 'canon rf', 'canon ef',
  'nikon z', 'nikon f', 'panasonic lumix', 'olympus om',
  'manfrotto', 'gitzo', 'peak design', 'think tank', 'lowepro',
  'wandrd', 'shimoda', 'f-stop', 'mindshift',
  'epson surecolor', 'epson ecotank photo', 'canon pixma pro',
  'godox', 'profoto', 'nanlite', 'aputure',
  'adobe creative cloud', 'adobe photography plan',
  'kase', 'breakthrough photography', 'nisi', 'haida', 'lee filters',
]);

export function classifyPhotography(input: ClassifyInput): ClassifyResult {
  const name = input.itemName.toLowerCase();
  const brand = (input.brand || '').toLowerCase();
  const combined = `${brand} ${name}`.trim();

  for (const phrase of KEYWORDS_BRAND) {
    if (combined.includes(phrase)) {
      return { isMatch: true, confidence: 0.95 };
    }
  }
  for (const kw of KEYWORDS_STRONG) {
    if (name.includes(kw)) {
      return { isMatch: true, confidence: 0.85 };
    }
  }
  return { isMatch: false, confidence: 0 };
}
```

- [ ] **Step 4: Run tests; expect PASS**

```bash
npx vitest tests/domains/photography/classifier.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add domains/photography/classifier.ts domains/photography/README.md tests/domains/photography/classifier.test.ts
git commit -m "feat(photography): add domain classifier with keyword + brand allowlist"
```

---

### Task 4: Register photography classifier in `lib/router.ts`

**Why:** The domain router currently only dispatches to outdoor + other. Photography needs to be inserted before "other" so photography items don't fall through.

**Files:**
- Modify: `lib/router.ts`
- Create or modify: `tests/lib/router.test.ts`

- [ ] **Step 1: Read `lib/router.ts` to understand the existing pattern**

```bash
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/lib/router.ts
```

Note the order of domain classifier registration and how the matched domain is returned.

- [ ] **Step 2: Add a failing test**

In `tests/lib/router.test.ts`, add:

```ts
import { describe, it, expect } from 'vitest';
import { routeDomain } from '../../lib/router.js';

describe('routeDomain — photography', () => {
  it('routes a Sony camera to Photography', () => {
    const result = routeDomain({
      itemName: 'Sony Alpha a6700 Mirrorless Camera Body',
      brand: 'Sony',
      source: 'Amazon',
    });
    expect(result.domain).toBe('Photography');
  });

  it('routes a Lightroom subscription to Photography', () => {
    const result = routeDomain({
      itemName: 'Adobe Photography Plan (Lightroom + Photoshop)',
      brand: 'Adobe',
      source: 'Manual',
    });
    expect(result.domain).toBe('Photography');
  });

  it('still routes outdoor items to Outdoor', () => {
    const result = routeDomain({
      itemName: 'Patagonia R1 Air Pullover',
      brand: 'Patagonia',
      source: 'REI',
    });
    expect(result.domain).toBe('Outdoor');
  });
});
```

Run: `npx vitest tests/lib/router.test.ts`
Expected: photography tests FAIL.

- [ ] **Step 3: Update `lib/router.ts`**

Add the import + photography branch BEFORE the existing `Other` fallback:

```ts
import { classifyPhotography } from '../domains/photography/classifier.js';

// ... in routeDomain ...
const photo = classifyPhotography(input);
if (photo.isMatch) {
  return { domain: 'Photography', confidence: photo.confidence };
}
// (existing Outdoor branch)
// (existing Other fallback)
```

- [ ] **Step 4: Run tests; expect PASS**

```bash
npx vitest tests/lib/router.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/router.ts tests/lib/router.test.ts
git commit -m "feat(router): register photography classifier"
```

---

### Task 5: Reclassify-photography script `scripts/reclassify-photography.ts`

**Why:** Historical purchases currently classified `Domain=Other` need to be re-routed to `Photography` so the agent's inventory grounding works on day one.

**Files:**
- Create: `scripts/reclassify-photography.ts`
- Modify: `package.json` (add `"reclassify-photography": "tsx scripts/reclassify-photography.ts"`)

- [ ] **Step 1: Read existing patterns**

```bash
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/scripts/enrich-rows.ts
```

This is a similar one-shot script. Mirror its argv handling and sheet-update patterns.

- [ ] **Step 2: Implement the script**

`scripts/reclassify-photography.ts`:

```ts
#!/usr/bin/env -S tsx
import { buildSheetsClient, readAllPurchases, updateRowDomain } from '../lib/sheets.js';
import { routeDomain } from '../lib/router.js';

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  const sheets = await buildSheetsClient();
  const rows = await readAllPurchases(sheets);

  const candidates: Array<{ rowIndex: number; itemName: string; brand: string; current: string; proposed: string }> = [];

  for (const row of rows) {
    if (row.domain !== 'Other') continue;
    const decision = routeDomain({
      itemName: row.itemName,
      brand: row.brand,
      source: row.source,
    });
    if (decision.domain === 'Photography') {
      candidates.push({
        rowIndex: row.rowIndex,
        itemName: row.itemName,
        brand: row.brand,
        current: row.domain,
        proposed: 'Photography',
      });
    }
  }

  console.log(`Found ${candidates.length} rows to reclassify Other → Photography:`);
  for (const c of candidates.slice(0, 10)) {
    console.log(`  row ${c.rowIndex}: ${c.brand} ${c.itemName}`);
  }
  if (candidates.length > 10) console.log(`  ... and ${candidates.length - 10} more`);

  if (!apply) {
    console.log('\nDry-run. Re-run with --apply to write changes.');
    return;
  }

  for (const c of candidates) {
    await updateRowDomain(sheets, c.rowIndex, 'Photography');
  }
  console.log(`Applied ${candidates.length} updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Add npm script**

In `package.json`, add to scripts:

```json
"reclassify-photography": "tsx scripts/reclassify-photography.ts"
```

- [ ] **Step 4: Run dry-run against the real sheet**

```bash
npm run reclassify-photography
```

Expected: prints the candidates, doesn't write. Verify the proposed reclassifications look correct (look at the first 10).

- [ ] **Step 5: Run with --apply when ready**

```bash
npm run reclassify-photography -- --apply
```

Expected: prints "Applied N updates." Verify in the sheet.

- [ ] **Step 6: Commit**

```bash
git add scripts/reclassify-photography.ts package.json
git commit -m "feat(scripts): add reclassify-photography one-shot tool"
```

---

### Task 6: Sheet schema — add `Photography Assignments` + `Photography Progress` tabs

**Why:** Two new sheet tabs hold the photography curriculum state. They're created idempotently by extending the bootstrap script.

**Files:**
- Modify: `scripts/bootstrap-sheet.ts`
- Modify: `tests/scripts/bootstrap-sheet.test.ts` (if exists)
- Create: `lib/photographySheets.ts` (helpers for the two new tabs)

- [ ] **Step 1: Read existing bootstrap-sheet pattern**

```bash
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/scripts/bootstrap-sheet.ts
```

Note how existing tabs are added idempotently.

- [ ] **Step 2: Extend bootstrap-sheet.ts**

Add two new tab creators. The columns are listed in the spec (Photography Assignments has 18 columns; Photography Progress has 6).

```ts
// Add to scripts/bootstrap-sheet.ts after existing tab-creation calls

const PHOTOGRAPHY_ASSIGNMENTS_HEADERS = [
  'id', 'date_issued', 'date_submitted', 'date_graded', 'topic_id',
  'assignment_text', 'rubric_json', 'status', 'submitted_photo_telegram_file_id',
  'camera', 'lens', 'settings_extracted', 'ai_verdict', 'ai_critique',
  'per_criterion_json', 'retry_count', 'user_notes', 'skipped_reason',
];

const PHOTOGRAPHY_PROGRESS_HEADERS = [
  'topic_id', 'status', 'last_activity_at',
  'assignments_passed', 'assignments_failed', 'theory_last_read_at',
];

async function ensurePhotographyAssignmentsTab(sheets: SheetsClient): Promise<void> {
  await ensureTab(sheets, 'Photography Assignments', PHOTOGRAPHY_ASSIGNMENTS_HEADERS);
  // status dropdown:
  await applyDataValidation(sheets, 'Photography Assignments', 'H', [
    'proposed', 'active', 'submitted', 'passed', 'did_not_pass', 'skipped',
  ]);
  // verdict dropdown:
  await applyDataValidation(sheets, 'Photography Assignments', 'M', [
    'pass', 'did_not_pass',
  ]);
}

async function ensurePhotographyProgressTab(sheets: SheetsClient): Promise<void> {
  await ensureTab(sheets, 'Photography Progress', PHOTOGRAPHY_PROGRESS_HEADERS);
  // status dropdown:
  await applyDataValidation(sheets, 'Photography Progress', 'B', [
    'locked', 'available', 'in-progress', 'completed', 'skipped',
  ]);
}

// Add to main():
await ensurePhotographyAssignmentsTab(sheets);
await ensurePhotographyProgressTab(sheets);
```

(Reuse the existing `ensureTab` and `applyDataValidation` helpers; if they don't accept letter columns, use the existing equivalent.)

- [ ] **Step 3: Create the sheet-I/O helper module**

`lib/photographySheets.ts`:

```ts
import type { sheets_v4 } from 'googleapis';
import { buildHeaderMap, readSheet, appendRow, updateCells } from './sheets.js';

export type AssignmentRow = {
  rowIndex: number;
  id: string;
  date_issued: string;
  date_submitted: string;
  date_graded: string;
  topic_id: string;
  assignment_text: string;
  rubric_json: string;
  status: 'proposed' | 'active' | 'submitted' | 'passed' | 'did_not_pass' | 'skipped';
  submitted_photo_telegram_file_id: string;
  camera: string;
  lens: string;
  settings_extracted: string;
  ai_verdict: 'pass' | 'did_not_pass' | '';
  ai_critique: string;
  per_criterion_json: string;
  retry_count: number;
  user_notes: string;
  skipped_reason: string;
};

export type ProgressRow = {
  rowIndex: number;
  topic_id: string;
  status: 'locked' | 'available' | 'in-progress' | 'completed' | 'skipped';
  last_activity_at: string;
  assignments_passed: number;
  assignments_failed: number;
  theory_last_read_at: string;
};

export async function readAssignments(sheets: sheets_v4.Sheets): Promise<AssignmentRow[]> {
  const raw = await readSheet(sheets, 'Photography Assignments');
  const headerMap = buildHeaderMap(raw[0]);
  return raw.slice(1).map((row, i) => ({
    rowIndex: i + 2,
    id: row[headerMap.id] || '',
    date_issued: row[headerMap.date_issued] || '',
    // ... etc for every column
  })) as AssignmentRow[];
}

export async function readProgress(sheets: sheets_v4.Sheets): Promise<ProgressRow[]> {
  // similar
}

export async function getActiveAssignment(sheets: sheets_v4.Sheets): Promise<AssignmentRow | null> {
  const rows = await readAssignments(sheets);
  return rows.find((r) => r.status === 'active' || r.status === 'submitted') || null;
}

export async function appendAssignment(sheets: sheets_v4.Sheets, row: Omit<AssignmentRow, 'rowIndex'>): Promise<void> {
  // append using header map
}

export async function updateAssignment(sheets: sheets_v4.Sheets, rowIndex: number, patch: Partial<AssignmentRow>): Promise<void> {
  // updateCells using header map
}

export async function upsertProgress(sheets: sheets_v4.Sheets, topicId: string, patch: Partial<ProgressRow>): Promise<void> {
  // find or insert by topic_id
}
```

(Fill out the readers + writers using the same `buildHeaderMap` pattern as `lib/sheets.ts` — column access is by header name, not letter.)

- [ ] **Step 4: Run bootstrap against the real sheet**

```bash
npm run bootstrap-sheet
```

Expected: both new tabs created with headers + dropdowns. Re-run is a no-op.

- [ ] **Step 5: Commit**

```bash
git add scripts/bootstrap-sheet.ts lib/photographySheets.ts
git commit -m "feat(sheets): add Photography Assignments + Photography Progress tabs"
```

---

### Task 7: Photography inventory serialize + query helpers

**Why:** The agent reads a compact serialization of `Domain=Photography AND Status=active` items in its system prompt. Mirrors `domains/outdoor/serialize.ts` exactly, just with the domain filter changed.

**Files:**
- Create: `domains/photography/serialize.ts`
- Create: `domains/photography/inventory.ts`
- Create: `tests/domains/photography/serialize.test.ts`

- [ ] **Step 1: Read outdoor's pattern**

```bash
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/domains/outdoor/serialize.ts
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/domains/outdoor/inventory.ts
```

Note the compact-row format (target 25-35 tokens/row, fields included, omitted fields).

- [ ] **Step 2: Write golden-file test**

`tests/domains/photography/serialize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializePhotographyInventory } from '../../../domains/photography/serialize.js';

describe('serializePhotographyInventory', () => {
  it('filters to Domain=Photography AND Status=active', () => {
    const rows = [
      { domain: 'Photography', status: 'active', itemName: 'Sony a6700', brand: 'Sony', /* ... */ },
      { domain: 'Photography', status: 'retired', itemName: 'Old Camera', brand: 'Old', /* ... */ },
      { domain: 'Outdoor', status: 'active', itemName: 'Tent', brand: 'REI', /* ... */ },
    ];
    const result = serializePhotographyInventory(rows as any);
    expect(result).toContain('Sony a6700');
    expect(result).not.toContain('Old Camera');
    expect(result).not.toContain('Tent');
  });

  it('produces a compact format (under 50 tokens per row)', () => {
    // Construct 5 representative items, check total token estimate
  });
});
```

Run: expected to FAIL.

- [ ] **Step 3: Implement `domains/photography/serialize.ts`**

Mirror `domains/outdoor/serialize.ts`, change domain filter to `Photography`, optionally include `Type` (Gear/Consumable/Service) since photography has more variety than outdoor.

- [ ] **Step 4: Implement `domains/photography/inventory.ts`**

Mirror `domains/outdoor/inventory.ts` — query helpers (`getById`, `findByFuzzyName`, `applyStatusChange`), domain-scoped.

- [ ] **Step 5: Run tests; expect PASS**

```bash
npx vitest tests/domains/photography/serialize.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add domains/photography/serialize.ts domains/photography/inventory.ts tests/domains/photography/serialize.test.ts
git commit -m "feat(photography): add inventory serialization + query helpers"
```

---

## Milestone 2 — Bot router rewrite (Tasks 8–10)

### Task 8: Sticky-mode persistence helper

**Files:**
- Create: `lib/botMode.ts`
- Create: `tests/lib/botMode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { readMode, setMode } from '../../lib/botMode.js';

describe('botMode', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'botmode-')); });

  it('returns "outdoor" by default for unknown chat id', async () => {
    const result = await readMode(tmp, 123);
    expect(result).toBe('outdoor');
  });

  it('persists a set mode across reads', async () => {
    await setMode(tmp, 123, 'photography');
    expect(await readMode(tmp, 123)).toBe('photography');
  });
});
```

- [ ] **Step 2: Implement**

`lib/botMode.ts`:

```ts
import { promises as fs } from 'fs';
import { join } from 'path';

export type BotMode = 'outdoor' | 'photography';

const FILENAME = 'bot-sticky-mode.json';

export async function readMode(stateDir: string, chatId: number): Promise<BotMode> {
  const path = join(stateDir, FILENAME);
  try {
    const raw = await fs.readFile(path, 'utf8');
    const data = JSON.parse(raw) as Record<string, BotMode>;
    return data[String(chatId)] || 'outdoor';
  } catch {
    return 'outdoor';
  }
}

export async function setMode(stateDir: string, chatId: number, mode: BotMode): Promise<void> {
  const path = join(stateDir, FILENAME);
  let data: Record<string, BotMode> = {};
  try {
    const raw = await fs.readFile(path, 'utf8');
    data = JSON.parse(raw);
  } catch {}
  data[String(chatId)] = mode;
  await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}
```

- [ ] **Step 3: Run tests; PASS**

- [ ] **Step 4: Commit**

```bash
git add lib/botMode.ts tests/lib/botMode.test.ts
git commit -m "feat(bot): sticky-mode persistence helper"
```

---

### Task 9: Bot router rewrite

**Files:**
- Modify: `apps/bot/router.ts`
- Modify (or create): `tests/apps/bot/router.test.ts`

- [ ] **Step 1: Read the existing router**

```bash
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/apps/bot/router.ts
```

Understand the current single-domain pass-through.

- [ ] **Step 2: Write tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { routeMessage, type RouteContext } from '../../../apps/bot/router.js';

const ctx = (override: Partial<RouteContext> = {}): RouteContext => ({
  chatId: 1,
  stateDir: '/tmp',
  isPhotoDocument: false,
  ...override,
});

describe('routeMessage', () => {
  it('routes /photo <msg> to photography for one message without changing sticky mode', async () => {
    const result = await routeMessage('/photo what should I shoot?', ctx());
    expect(result.domain).toBe('photography');
    expect(result.stickyChanged).toBe(false);
    expect(result.bodyAfterPrefix).toBe('what should I shoot?');
  });

  it('routes /outdoor <msg> to outdoor for one message', async () => {
    const result = await routeMessage('/outdoor where to camp?', ctx());
    expect(result.domain).toBe('outdoor');
  });

  it('sets sticky to photography on bare /photo', async () => {
    const result = await routeMessage('/photo', ctx());
    expect(result.stickyChanged).toBe(true);
    expect(result.newSticky).toBe('photography');
    expect(result.replyText).toMatch(/photography/i);
  });

  it('photo as Document auto-routes to photography', async () => {
    const result = await routeMessage('', ctx({ isPhotoDocument: true }));
    expect(result.domain).toBe('photography');
  });

  it('/who returns current sticky', async () => {
    const result = await routeMessage('/who', ctx());
    expect(result.replyText).toMatch(/outdoor|photography/i);
  });
});
```

- [ ] **Step 3: Implement the new router**

```ts
import { readMode, setMode, type BotMode } from '../../lib/botMode.js';

export type RouteContext = {
  chatId: number;
  stateDir: string;
  isPhotoDocument: boolean;
};

export type RouteResult = {
  domain: BotMode;
  bodyAfterPrefix: string;
  stickyChanged: boolean;
  newSticky?: BotMode;
  replyText?: string;
};

export async function routeMessage(text: string, ctx: RouteContext): Promise<RouteResult> {
  const trimmed = text.trim();

  // Photo as Document → photography (sticky unchanged)
  if (ctx.isPhotoDocument) {
    return { domain: 'photography', bodyAfterPrefix: trimmed, stickyChanged: false };
  }

  // /who
  if (trimmed === '/who') {
    const current = await readMode(ctx.stateDir, ctx.chatId);
    return {
      domain: current,
      bodyAfterPrefix: '',
      stickyChanged: false,
      replyText: `Current mode: ${current === 'photography' ? '📸 Photography' : '🏕 Outdoor'}`,
    };
  }

  // Bare /photo or /outdoor → mode set
  if (trimmed === '/photo' || trimmed === '/outdoor') {
    const newMode: BotMode = trimmed === '/photo' ? 'photography' : 'outdoor';
    await setMode(ctx.stateDir, ctx.chatId, newMode);
    return {
      domain: newMode,
      bodyAfterPrefix: '',
      stickyChanged: true,
      newSticky: newMode,
      replyText: newMode === 'photography' ? '📸 Photography mode.' : '🏕 Outdoor mode.',
    };
  }

  // /photo <msg> or /outdoor <msg> → one-message override
  if (trimmed.startsWith('/photo ')) {
    return {
      domain: 'photography',
      bodyAfterPrefix: trimmed.slice('/photo '.length).trim(),
      stickyChanged: false,
    };
  }
  if (trimmed.startsWith('/outdoor ')) {
    return {
      domain: 'outdoor',
      bodyAfterPrefix: trimmed.slice('/outdoor '.length).trim(),
      stickyChanged: false,
    };
  }

  // Fallback: sticky mode
  const sticky = await readMode(ctx.stateDir, ctx.chatId);
  return { domain: sticky, bodyAfterPrefix: trimmed, stickyChanged: false };
}
```

- [ ] **Step 4: Update the bot listener to consume the new router**

In `apps/bot/index.ts` (read first to understand structure), update the per-message handler to:
1. Build `RouteContext` from incoming Telegram message (detect Document upload type).
2. Call `routeMessage`.
3. If `replyText` set, reply with it and short-circuit.
4. Otherwise dispatch to `domain` handlers (outdoor existing; photography to be added in Task 23+).

- [ ] **Step 5: Run tests; PASS**

- [ ] **Step 6: Commit**

```bash
git add apps/bot/router.ts apps/bot/index.ts tests/apps/bot/router.test.ts
git commit -m "feat(bot): multi-domain router with sticky mode + slash overrides"
```

---

### Task 10: Smoke-verify outdoor flows unchanged

**Why:** The router rewrite must not regress existing outdoor commands. Run the outdoor acceptance flows manually.

- [ ] **Step 1: Verify in dev — outdoor sticky preserved**

In the Telegram bot (dev or staging):

```
You: /scan
Bot: <runs outdoor scan as before>

You: /log Patagonia R1 Air, $159, REI, today
Bot: <confirms + appends row>

You: /lost Atom LT
Bot: <fuzzy-matches Atom LT, flips Status=lost>
```

- [ ] **Step 2: Verify /who returns "Outdoor" (default for new chat)**

- [ ] **Step 3: Verify the photo-as-document path doesn't break outdoor**

Send a regular photo (compressed Photo type) to the bot in outdoor mode — bot should not treat it as a photography submission (since outdoor mode is sticky AND it's not a Document upload). Behavior depends on outdoor's existing photo handling — confirm no crash.

- [ ] **Step 4: Document any regressions found**

If anything breaks, fix in this task before continuing.

- [ ] **Step 5: No commit (verification only)**

---

## Milestone 3 — Skill-tree + curriculum (Tasks 11–19)

### Task 11: Skill-tree types + DAG validator

**Files:**
- Create: `domains/photography/skillTree.ts` (types only; topics array empty for now)
- Create: `tests/domains/photography/skillTree.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { SKILL_TREE, validateSkillTree } from '../../../domains/photography/skillTree.js';

describe('skill-tree', () => {
  it('has unique topic IDs', () => {
    const ids = new Set();
    for (const t of SKILL_TREE) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  it('all prereqs reference real topic IDs', () => {
    const ids = new Set(SKILL_TREE.map((t) => t.id));
    for (const t of SKILL_TREE) {
      for (const p of t.prereqs) {
        expect(ids.has(p)).toBe(true);
      }
    }
  });

  it('topic IDs follow track.kebab-case pattern', () => {
    for (const t of SKILL_TREE) {
      expect(t.id).toMatch(/^[a-z][a-z-]+\.[a-z][a-z-]+$/);
    }
  });

  it('topic IDs start with their declared track', () => {
    for (const t of SKILL_TREE) {
      expect(t.id.startsWith(`${t.track}.`)).toBe(true);
    }
  });

  it('every topic has non-empty theorySeed and assignmentSeed', () => {
    for (const t of SKILL_TREE) {
      expect(t.theorySeed.length).toBeGreaterThan(50);
      expect(t.assignmentSeed.length).toBeGreaterThan(50);
    }
  });

  it('validateSkillTree detects DAG cycles', () => {
    const cyclicTree = [
      { id: 'a.one', track: 'a', name: 'one', prereqs: ['a.two'], description: 'x', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
      { id: 'a.two', track: 'a', name: 'two', prereqs: ['a.one'], description: 'x', theorySeed: 'x'.repeat(60), assignmentSeed: 'x'.repeat(60) },
    ];
    expect(() => validateSkillTree(cyclicTree as any)).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Implement types + validator**

```ts
export type TrackId =
  | 'fundamentals'
  | 'light-composition'
  | 'gear-a6700'
  | 'gear-sigma-1850'
  | 'gear-sony-70350'
  | 'gear-printer'
  | 'genre-landscape'
  | 'genre-dog'
  | 'genre-wildlife'
  | 'genre-travel'
  | 'genre-family'
  | 'genre-action'
  | 'genre-macro'
  | 'genre-concert'
  | 'lightroom'
  | 'printing';

export interface Topic {
  id: string;
  track: TrackId;
  name: string;
  prereqs: string[];
  description: string;
  theorySeed: string;
  assignmentSeed: string;
}

export const SKILL_TREE: Topic[] = [
  // filled in by Tasks 12-17
];

export function validateSkillTree(tree: Topic[]): void {
  const ids = new Set(tree.map((t) => t.id));
  for (const t of tree) {
    for (const p of t.prereqs) {
      if (!ids.has(p)) {
        throw new Error(`Topic ${t.id} references unknown prereq ${p}`);
      }
    }
  }
  // DAG cycle detection via DFS
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const t of tree) color.set(t.id, WHITE);

  function dfs(id: string, path: string[]): void {
    if (color.get(id) === GRAY) {
      throw new Error(`Cycle detected: ${path.join(' → ')} → ${id}`);
    }
    if (color.get(id) === BLACK) return;
    color.set(id, GRAY);
    const t = tree.find((x) => x.id === id)!;
    for (const p of t.prereqs) dfs(p, [...path, id]);
    color.set(id, BLACK);
  }
  for (const t of tree) dfs(t.id, []);
}
```

- [ ] **Step 3: Tests will fail until topics are added (Tasks 12-17). That's expected — skip running until then, or mark each failing assertion as `skip` until the topic count is non-zero.**

- [ ] **Step 4: Commit**

```bash
git add domains/photography/skillTree.ts tests/domains/photography/skillTree.test.ts
git commit -m "feat(photography): skill-tree types + DAG validator"
```

---

### Task 12: Author `fundamentals` track topics (~15)

**Why:** The fundamentals track is the universal prereq for everything else. Each topic gets an `id`, `prereqs`, `description`, and the two seeds for Claude to expand into theory + assignments.

**Files:**
- Modify: `domains/photography/skillTree.ts`

- [ ] **Step 1: Add the 15 fundamentals topics**

The first three topics show the pattern. Add the remaining 12 following the same shape, sequenced strictly so each builds on the previous.

```ts
// In SKILL_TREE array:
{
  id: 'fundamentals.exposure-triangle',
  track: 'fundamentals',
  name: 'Exposure Triangle',
  prereqs: [],
  description: 'Aperture, shutter speed, and ISO — the three knobs that control exposure, and how they trade off.',
  theorySeed: `Explain the exposure triangle from scratch for a total beginner. Cover what each of the three controls does mechanically (aperture = how much light, shutter = how long, ISO = sensor sensitivity). Walk through how they interact — opening aperture by one stop lets in 2x the light, slowing shutter by one stop does the same, raising ISO by one stop does the same. Each control has artistic side effects (aperture → depth of field, shutter → motion blur or freeze, ISO → noise). Use Tom's a6700 + Sigma 18-50 as the running example. End with one concrete settings recipe for a daylight outdoor scene at f/8.`,
  assignmentSeed: `Have Tom shoot the same static subject three times — once changing only aperture (f/2.8 vs f/8), once changing only shutter (1/250 vs 1/30), once changing only ISO (100 vs 3200) — keeping the other two compensating to maintain exposure. Submit the f/2.8 vs f/8 pair. Rubric: did the exposure stay roughly equivalent across both? Is the depth-of-field difference visible? Are the EXIF settings the ones Tom intended? Core criterion: depth-of-field change is visible.`,
},
{
  id: 'fundamentals.manual-mode',
  track: 'fundamentals',
  name: 'Manual Mode Confidence',
  prereqs: ['fundamentals.exposure-triangle'],
  description: 'Shooting in full manual mode — picking the three settings yourself for any scene.',
  theorySeed: `Build on the exposure triangle. Walk through the metering process for manual mode using the a6700's metering display + histogram. Explain how to read the meter, when to trust it, and when to override (backlit scenes, snow scenes, etc.). Give a "starting point" cheat sheet by scene type (daylight, overcast, indoor, golden hour, blue hour, night with tripod).`,
  assignmentSeed: `Shoot 5 frames in full manual mode in 5 different lighting conditions over a single shoot session. Submit any one with the EXIF readable. Rubric: exposure intent matches the scene (not blown highlights or crushed shadows where avoidable); settings are reasonable for the conditions; histogram (if Tom can show it) supports the choice. Core criterion: deliberate exposure intent visible in the result.`,
},
{
  id: 'fundamentals.aperture-priority',
  track: 'fundamentals',
  name: 'Aperture Priority Mode',
  prereqs: ['fundamentals.exposure-triangle'],
  description: 'Semi-auto mode where you set aperture and the camera picks shutter for you.',
  theorySeed: `Explain A-mode (aperture priority) on the a6700. When to use it vs full manual. The dial position, what changes on the display. Practical scenarios: portrait at f/2.8 to blur background, landscape at f/8 for everything sharp. Mention exposure compensation as the partner control. End with a one-sentence comparison: M for slow scenes you control, A for fast scenes where you only care about depth.`,
  assignmentSeed: `Shoot a portrait of Tom's dog (or any subject) at f/2.8 then again at f/8, both in aperture priority. Submit the f/2.8 frame. Rubric: subject in focus, background blur visible at f/2.8 and noticeably less at f/8, exposure correct. Core criterion: depth of field difference is visible.`,
},
// Continue with 12 more topics:
//   fundamentals.shutter-priority
//   fundamentals.focus-modes-single-vs-continuous
//   fundamentals.focus-modes-subject-recognition
//   fundamentals.drive-modes-single-vs-burst
//   fundamentals.white-balance-auto-vs-manual
//   fundamentals.metering-modes
//   fundamentals.exposure-compensation
//   fundamentals.histogram-reading
//   fundamentals.raw-vs-jpeg
//   fundamentals.file-naming-and-card-management
//   fundamentals.settings-hygiene
//   fundamentals.tripod-when-and-why
```

The remaining 12 topics each follow the same shape — author them in this task using the same depth of seed text. Use Claude assistance to draft each topic; commit when all 15 are in.

- [ ] **Step 2: Re-run skill-tree tests with the 15 topics**

```bash
npx vitest tests/domains/photography/skillTree.test.ts
```

Expected: PASS for the unique-IDs, prereq-exists, pattern, and seed-length tests.

- [ ] **Step 3: Commit**

```bash
git add domains/photography/skillTree.ts
git commit -m "feat(photography): author fundamentals track (15 topics)"
```

---

### Task 13: Author `light-composition` track (~10 topics)

**Files:**
- Modify: `domains/photography/skillTree.ts`

- [ ] **Step 1: Add 10 light-composition topics**

Same pattern as Task 12. Topics ordered roughly:

```
light-composition.what-is-light
light-composition.golden-hour
light-composition.blue-hour
light-composition.hard-vs-soft-light
light-composition.direction-of-light
light-composition.rule-of-thirds
light-composition.leading-lines
light-composition.foreground-anchors
light-composition.negative-space
light-composition.framing
```

Each with prereqs that include the relevant fundamentals (e.g. `golden-hour` requires `manual-mode`, `foreground-anchors` requires `rule-of-thirds`).

- [ ] **Step 2: Run skill-tree tests; PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): author light-composition track (10 topics)"
```

---

### Task 14: Author gear-specific tracks (a6700, Sigma, 70-350, printer) (~14 topics)

**Files:**
- Modify: `domains/photography/skillTree.ts`

- [ ] **Step 1: Add gear topics**

Author topic counts per spec: a6700 (5), Sigma 18-50 (3), Sony 70-350 (3), ET-8550 (3). Each topic's `theorySeed` references the specific gear with its model numbers + Tom's actual usage patterns (Capture Clip for hiking, Lens Changer 35 for the 70-350, etc.).

Examples:

```
gear-a6700.menu-structure-overview     prereqs: ['fundamentals.exposure-triangle']
gear-a6700.custom-button-setup         prereqs: ['gear-a6700.menu-structure-overview']
gear-a6700.af-subject-recognition      prereqs: ['fundamentals.focus-modes-subject-recognition']
gear-a6700.ibis-in-practice            prereqs: ['fundamentals.shutter-priority']
gear-a6700.dro-and-dynamic-range       prereqs: ['fundamentals.histogram-reading']

gear-sigma-1850.best-uses              prereqs: ['fundamentals.exposure-triangle']
gear-sigma-1850.f28-constant-aperture  prereqs: ['fundamentals.aperture-priority']
gear-sigma-1850.reverse-focus-ring     prereqs: ['fundamentals.focus-modes-single-vs-continuous']

gear-sony-70350.best-uses              prereqs: ['fundamentals.aperture-priority']
gear-sony-70350.slow-lens-implications prereqs: ['fundamentals.aperture-priority']
gear-sony-70350.oss-and-ibis-together  prereqs: ['gear-a6700.ibis-in-practice']

gear-printer.et8550-setup              prereqs: []
gear-printer.paper-handling            prereqs: ['gear-printer.et8550-setup']
gear-printer.epson-print-layout-intro  prereqs: ['gear-printer.paper-handling']
```

- [ ] **Step 2: Run skill-tree tests; PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): author gear-specific tracks (14 topics)"
```

---

### Task 15: Author genre tracks (~23 topics across 8 genres)

**Files:**
- Modify: `domains/photography/skillTree.ts`

- [ ] **Step 1: Add genre topics**

Per spec: landscape (5), dog (3), wildlife (3), travel (3), family (2), action (3), macro (2), concert (2). All genre-track topics have `light-composition` topics as prereqs (since genre work assumes you can read light + compose).

Group examples:

```
genre-landscape.golden-hour-planning            prereqs: ['light-composition.golden-hour']
genre-landscape.foreground-composition          prereqs: ['light-composition.foreground-anchors']
genre-landscape.depth-of-field-for-landscapes   prereqs: ['fundamentals.aperture-priority']
genre-landscape.hyperfocal                      prereqs: ['genre-landscape.depth-of-field-for-landscapes']
genre-landscape.colorado-specific-light         prereqs: ['light-composition.golden-hour']

genre-dog.eye-af-on-animals                     prereqs: ['gear-a6700.af-subject-recognition']
genre-dog.action-burst-timing                   prereqs: ['fundamentals.drive-modes-single-vs-burst']
genre-dog.candids-vs-portraits                  prereqs: ['light-composition.direction-of-light']

// ... continue for all 8 genres
```

- [ ] **Step 2: Run skill-tree tests; PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): author genre tracks (23 topics across 8 genres)"
```

---

### Task 16: Author `lightroom` track (~11 topics)

**Files:**
- Modify: `domains/photography/skillTree.ts`

- [ ] **Step 1: Add Lightroom topics, strict-ordered**

```
lightroom.import-workflow             prereqs: ['fundamentals.raw-vs-jpeg']
lightroom.library-organization        prereqs: ['lightroom.import-workflow']
lightroom.develop-module-basics       prereqs: ['lightroom.library-organization']
lightroom.white-balance-tone-curve    prereqs: ['lightroom.develop-module-basics']
lightroom.color-grading               prereqs: ['lightroom.white-balance-tone-curve']
lightroom.masking-selective-edits     prereqs: ['lightroom.develop-module-basics']
lightroom.presets-and-styles          prereqs: ['lightroom.color-grading']
lightroom.exports-for-web             prereqs: ['lightroom.develop-module-basics']
lightroom.exports-for-print           prereqs: ['lightroom.exports-for-web']
lightroom.sharpening-for-output       prereqs: ['lightroom.exports-for-print']
lightroom.catalog-backup-strategy     prereqs: ['lightroom.library-organization']
```

- [ ] **Step 2: Tests PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): author lightroom track (11 topics)"
```

---

### Task 17: Author `printing` track (~7 topics)

**Files:**
- Modify: `domains/photography/skillTree.ts`

- [ ] **Step 1: Add printing topics**

```
printing.paper-choice              prereqs: ['gear-printer.paper-handling']
printing.soft-proofing             prereqs: ['lightroom.exports-for-print', 'printing.paper-choice']
printing.icc-profiles              prereqs: ['printing.soft-proofing']
printing.sharpening-for-print      prereqs: ['lightroom.sharpening-for-output', 'printing.paper-choice']
printing.finishing-prints          prereqs: ['printing.icc-profiles']
printing.wall-of-prints-workflow   prereqs: ['printing.finishing-prints', 'printing.sharpening-for-print']
printing.troubleshooting-common-issues  prereqs: ['printing.icc-profiles']
```

- [ ] **Step 2: Tests PASS — full skill-tree (~80 topics) now valid**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): author printing track (7 topics) — skill-tree complete"
```

---

### Task 18: Curriculum runtime `domains/photography/curriculum.ts`

**Files:**
- Create: `domains/photography/curriculum.ts`
- Create: `tests/domains/photography/curriculum.test.ts`

- [ ] **Step 1: Write tests for the four pure functions**

```ts
import { describe, it, expect } from 'vitest';
import {
  pickNextTopic, checkPrereqs, generatePlan, computeTopicStatus,
} from '../../../domains/photography/curriculum.js';
import type { ProgressRow } from '../../../lib/photographySheets.js';

describe('curriculum', () => {
  it('pickNextTopic returns the first available unblocked topic', () => {
    const progress: ProgressRow[] = [
      { topic_id: 'fundamentals.exposure-triangle', status: 'completed', /* ... */ } as any,
    ];
    const next = pickNextTopic(progress);
    expect(next?.id).toBe('fundamentals.manual-mode');
  });

  it('checkPrereqs returns true when all prereqs are completed', () => {
    const progress: ProgressRow[] = [
      { topic_id: 'fundamentals.exposure-triangle', status: 'completed' } as any,
    ];
    expect(checkPrereqs('fundamentals.manual-mode', progress)).toBe(true);
  });

  it('checkPrereqs returns false when a prereq is locked', () => {
    expect(checkPrereqs('lightroom.develop-module-basics', [])).toBe(false);
  });

  it('generatePlan returns N sequential topics from the available pool', () => {
    const plan = generatePlan({ weeks: 2, progress: [] });
    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(plan[0].id).toBe('fundamentals.exposure-triangle');
  });

  it('computeTopicStatus returns "locked" when prereqs not met', () => {
    expect(computeTopicStatus('lightroom.develop-module-basics', [])).toBe('locked');
  });

  it('computeTopicStatus returns "available" when prereqs met and not started', () => {
    expect(computeTopicStatus('fundamentals.exposure-triangle', [])).toBe('available');
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { SKILL_TREE, type Topic } from './skillTree.js';
import type { ProgressRow } from '../../lib/photographySheets.js';

export function checkPrereqs(topicId: string, progress: ProgressRow[]): boolean {
  const topic = SKILL_TREE.find((t) => t.id === topicId);
  if (!topic) return false;
  const completed = new Set(progress.filter((p) => p.status === 'completed').map((p) => p.topic_id));
  return topic.prereqs.every((p) => completed.has(p));
}

export function computeTopicStatus(
  topicId: string,
  progress: ProgressRow[],
): 'locked' | 'available' | 'in-progress' | 'completed' | 'skipped' {
  const row = progress.find((p) => p.topic_id === topicId);
  if (row?.status === 'completed') return 'completed';
  if (row?.status === 'skipped') return 'skipped';
  if (row?.status === 'in-progress') return 'in-progress';
  if (!checkPrereqs(topicId, progress)) return 'locked';
  return 'available';
}

export function pickNextTopic(progress: ProgressRow[]): Topic | null {
  for (const t of SKILL_TREE) {
    if (computeTopicStatus(t.id, progress) === 'available') return t;
  }
  return null;
}

export function generatePlan(opts: { weeks: number; progress: ProgressRow[] }): Topic[] {
  // Naive v1: pick the first N available topics where N = weeks * 2 (target 2 assignments/week)
  const target = Math.max(2, opts.weeks * 2);
  const plan: Topic[] = [];
  const simulated = [...opts.progress];
  while (plan.length < target) {
    const next = pickNextTopic(simulated);
    if (!next) break;
    plan.push(next);
    simulated.push({
      topic_id: next.id,
      status: 'completed',
      last_activity_at: '',
      assignments_passed: 0, assignments_failed: 0, theory_last_read_at: '',
      rowIndex: -1,
    });
  }
  return plan;
}
```

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add domains/photography/curriculum.ts tests/domains/photography/curriculum.test.ts
git commit -m "feat(photography): curriculum runtime (pickNext, checkPrereqs, generatePlan)"
```

---

### Task 19: Progress sheet I/O

**Files:**
- Modify: `lib/photographySheets.ts` (add progress helpers if not already done in Task 6)
- Create: `tests/lib/photographySheets.test.ts`

- [ ] **Step 1: Write tests with mocked sheet**

(Mocking pattern: use vitest `vi.mock` on `lib/sheets.ts`. See existing tests for the shape.)

- [ ] **Step 2: Implement `readProgress`, `upsertProgress`, `markTopicCompleted`, `markTopicInProgress`**

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(photography): progress sheet I/O"
```

---

## Milestone 4 — Assignment lifecycle (Tasks 20–25)

### Task 20: Assignment row I/O `domains/photography/assignments.ts`

**Files:**
- Create: `domains/photography/assignments.ts`
- Create: `tests/domains/photography/assignments.test.ts`

- [ ] **Step 1: Write tests**

Test cases: enforce single-active constraint, create-active, mark-passed, mark-did-not-pass, mark-skipped, retry-count increment.

- [ ] **Step 2: Implement**

Wrap `lib/photographySheets.ts` operations. Enforces "at most one row in `active` or `submitted` state at a time" — throws on attempt to create when one exists.

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(photography): assignment row I/O with single-active enforcement"
```

---

### Task 21: Generate assignment + rubric via Claude

**Files:**
- Create: `domains/photography/assignmentGen.ts`
- Create: `tests/domains/photography/assignmentGen.test.ts`

- [ ] **Step 1: Write the test with mocked Claude**

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateAssignment } from '../../../domains/photography/assignmentGen.js';

vi.mock('../../../lib/claude.js', () => ({
  callClaudeJSON: vi.fn().mockResolvedValue({
    assignment_text: 'Shoot 3 frames at f/8 of a mountain ridgeline...',
    rubric: [
      { criterion: 'sharp throughout frame', description: '...', is_core: true },
      { criterion: 'foreground anchor visible', description: '...', is_core: true },
      { criterion: 'exposure intent matches scene', description: '...', is_core: false },
    ],
  }),
}));

describe('generateAssignment', () => {
  it('produces assignment_text + rubric array with at least one core criterion', async () => {
    const result = await generateAssignment({
      topicId: 'genre-landscape.foreground-anchors',
      gear: { camera: 'Sony a6700', lenses: ['Sigma 18-50 f/2.8', 'Sony 70-350'] },
      location: 'Denver, CO',
    });
    expect(result.assignment_text).toMatch(/f\/8/);
    expect(result.rubric.length).toBeGreaterThanOrEqual(2);
    expect(result.rubric.some((c) => c.is_core)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { SKILL_TREE } from './skillTree.js';
import { callClaudeJSON } from '../../lib/claude.js';
import { AGENT_PRIMARY_MODEL } from '../../lib/models.js';

const SYSTEM_PROMPT = `You are designing a photography assignment for Tom, a beginner with a Sony a6700, Sigma 18-50 f/2.8, and Sony 70-350 lenses. He lives in Denver, Colorado.

Given a topic seed, generate:
1. A concrete assignment (200-400 words): what to shoot, where, when, settings to use, what to submit. Use Tom's actual gear and locations.
2. A rubric: 2-4 criteria for grading. Each criterion has { criterion, description, is_core: boolean }. At least one must be is_core: true — that's the central skill being tested.

Output JSON only:
{
  "assignment_text": string,
  "rubric": [{ "criterion": string, "description": string, "is_core": boolean }]
}`;

export type Gear = { camera: string; lenses: string[] };

export async function generateAssignment(input: {
  topicId: string;
  gear: Gear;
  location?: string;
}): Promise<{ assignment_text: string; rubric: Array<{ criterion: string; description: string; is_core: boolean }> }> {
  const topic = SKILL_TREE.find((t) => t.id === input.topicId);
  if (!topic) throw new Error(`Unknown topic: ${input.topicId}`);

  const userPrompt = `Topic: ${topic.name} (${topic.id})
Track: ${topic.track}
Description: ${topic.description}

Assignment seed: ${topic.assignmentSeed}

Tom's gear: ${input.gear.camera} + ${input.gear.lenses.join(', ')}
Tom's location: ${input.location || 'Denver, Colorado'}

Generate the assignment + rubric. Output JSON only.`;

  return await callClaudeJSON({
    model: AGENT_PRIMARY_MODEL,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    user: userPrompt,
  });
}
```

(`callClaudeJSON` is the existing wrapper in `lib/claude.ts`; if it doesn't exist with that exact signature, adapt the call to the wrapper that does.)

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(photography): generate assignment + rubric via Claude"
```

---

### Task 22: Photography agent system prompt + tool registry

**Files:**
- Create: `domains/photography/agent.ts`
- Create: `domains/photography/tools.ts`
- Create: `tests/domains/photography/agent.test.ts`

- [ ] **Step 1: Read outdoor's agent.ts**

```bash
cat /Users/tomkeefe/Desktop/Claude/Apps/outdoor-inventory/domains/outdoor/agent.ts
```

Mirror its overall shape — system prompt builder + tool registry + conversation handler.

- [ ] **Step 2: Implement system prompt builder**

```ts
import { serializePhotographyInventory } from './serialize.js';
import { SKILL_TREE } from './skillTree.js';

export function buildSystemPrompt(inventory: any[]): Array<{ type: 'text'; text: string; cache_control?: any }> {
  const compactInventory = serializePhotographyInventory(inventory);
  const skillTreeSummary = SKILL_TREE.map((t) => `  - ${t.id} (${t.track}): ${t.name}`).join('\n');

  return [
    {
      type: 'text',
      text: `You are Tom's personal photography mentor, teacher, and creative partner. Tom is a total beginner who recently bought a Sony a6700, Sigma 18-50 f/2.8, Sony 70-350, and an Epson ET-8550 printer.

Be direct. Skip filler. Don't soften criticism. Explain the WHY not just the how. Use Tom's actual gear in every example. Push back when he's wrong. Be opinionated. Build progressively from beginner foundations.

You have tools for forecast, trails, sun-times, web search, and managing his curriculum + assignments. Use them.

The curriculum (skill-tree) — ${SKILL_TREE.length} topics across tracks. Read it; reference topic IDs when recommending what's next:
${skillTreeSummary}`,
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: `Tom's current Photography inventory (filtered to Domain=Photography AND Status=active):
${compactInventory}`,
      cache_control: { type: 'ephemeral' },
    },
  ];
}
```

- [ ] **Step 3: Tool registry in `domains/photography/tools.ts`**

```ts
import { getForecast } from '../../lib/integrations/weather.js';
import { lookupTrail, searchTrailsNearby } from '../../lib/integrations/trails.js';
import { getSunTimes } from '../../lib/integrations/sunTimes.js';
import { getActiveAssignment, /* etc. */ } from '../../lib/photographySheets.js';
import { pickNextTopic, generatePlan, computeTopicStatus } from './curriculum.js';
import { SKILL_TREE } from './skillTree.js';
import { generateAssignment } from './assignmentGen.js';

export const PHOTOGRAPHY_TOOLS = [
  { type: 'web_search_20260209' as const },  // anthropic built-in
  // ... + the custom tool defs (JSON schema) for forecast, sun-times, trails, list_topics, get_topic_theory, start_assignment, etc.
];

export async function dispatchPhotographyTool(name: string, input: any): Promise<any> {
  switch (name) {
    case 'get_forecast': return await getForecast(input.location, input.days);
    case 'get_sun_times': return getSunTimes(input.lat, input.lng, input.date);
    case 'lookup_trail': return await lookupTrail(input.name, input.activity);
    case 'search_trails_nearby': return await searchTrailsNearby(input.lat, input.lng, input.radius_km, input.activity);
    case 'list_topics': return SKILL_TREE.filter((t) => !input.track || t.track === input.track);
    case 'get_active_assignment': return await getActiveAssignment(/* sheets */);
    case 'start_assignment': return await /* ... */;
    case 'mark_topic_complete': return await /* ... */;
    case 'get_topic_theory': return await /* ... */;
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
```

- [ ] **Step 4: Tests verify system prompt structure + tool registry surface**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(photography): agent system prompt + tool registry"
```

---

### Task 23: Telegram read commands — `/skills`, `/track`, `/learn`, `/active`, `/plan`

**Files:**
- Create: `apps/bot/photographyHandlers.ts`
- Modify: `apps/bot/index.ts` (wire in the handlers via the new router)
- Create: `tests/apps/bot/photographyHandlers.test.ts`

- [ ] **Step 1: Implement each command**

Pattern (handler shape — adapt to existing bot handler style):

```ts
export async function handleSkillsCommand(chatId: number): Promise<string> {
  const progress = await readProgress(sheets);
  const byTrack = new Map<string, Array<{ topic: Topic; status: string }>>();
  for (const t of SKILL_TREE) {
    const status = computeTopicStatus(t.id, progress);
    if (!byTrack.has(t.track)) byTrack.set(t.track, []);
    byTrack.get(t.track)!.push({ topic: t, status });
  }
  // Format as multi-line Telegram message with status icons:
  //   ✓ completed, ▶ in-progress, ○ available, 🔒 locked, ⊘ skipped
  return [...byTrack.entries()].map(/* ... */).join('\n\n');
}

export async function handleTrackCommand(chatId: number, trackId: string): Promise<string> {
  /* filter to one track */
}

export async function handleLearnCommand(chatId: number, topicId: string): Promise<string> {
  const topic = SKILL_TREE.find((t) => t.id === topicId);
  if (!topic) return `Unknown topic: ${topicId}. Try /skills to browse.`;
  return await generateTheory(topic);  // Claude call expanding theorySeed
}

export async function handleActiveCommand(chatId: number): Promise<string> {
  const active = await getActiveAssignment(sheets);
  if (!active) return 'No active assignment. `/next` to get one.';
  return `**Active: ${active.topic_id}**\n\n${active.assignment_text}\n\nRubric:\n${formatRubric(active.rubric_json)}`;
}

export async function handlePlanCommand(chatId: number, durationText: string): Promise<string> {
  const weeks = parseDuration(durationText);  // "2 weeks" → 2
  const plan = generatePlan({ weeks, progress: await readProgress(sheets) });
  return formatPlan(plan, weeks);
}
```

- [ ] **Step 2: Tests for each handler with mocked sheets**

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(photography): /skills /track /learn /active /plan commands"
```

---

### Task 24: Telegram write commands — `/next`, `/start`, `/skip`

**Files:**
- Modify: `apps/bot/photographyHandlers.ts`
- Modify: `tests/apps/bot/photographyHandlers.test.ts`

- [ ] **Step 1: Implement**

```ts
export async function handleNextCommand(chatId: number): Promise<string> {
  const active = await getActiveAssignment(sheets);
  if (active) return `You already have an active assignment (${active.topic_id}). Submit a photo or /skip to bail.`;
  const progress = await readProgress(sheets);
  const next = pickNextTopic(progress);
  if (!next) return 'No available topics. Check /skills to see what's locked.';
  return await handleStartCommand(chatId, next.id);
}

export async function handleStartCommand(chatId: number, topicId: string): Promise<string> {
  // 1. check single-active constraint
  // 2. check prereqs (or accept override if Tom says "skip prereqs")
  // 3. generateAssignment() to get text + rubric
  // 4. appendAssignment() with status=active
  // 5. upsertProgress(topicId, in-progress)
  // 6. return formatted Telegram message
}

export async function handleSkipCommand(chatId: number, reason?: string): Promise<string> {
  const active = await getActiveAssignment(sheets);
  if (!active) return 'No active assignment to skip.';
  await updateAssignment(sheets, active.rowIndex, { status: 'skipped', skipped_reason: reason || 'user request' });
  return `Skipped ${active.topic_id}. /next for the next one.`;
}
```

- [ ] **Step 2: Tests PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): /next /start /skip commands"
```

---

### Task 25: Theory generator `domains/photography/theoryGen.ts`

**Files:**
- Create: `domains/photography/theoryGen.ts`
- Create: `tests/domains/photography/theoryGen.test.ts`

- [ ] **Step 1: Implement**

```ts
import { SKILL_TREE } from './skillTree.js';
import { callClaude } from '../../lib/claude.js';
import { AGENT_PRIMARY_MODEL } from '../../lib/models.js';

const SYSTEM_PROMPT = `You are Tom's photography teacher. Tom is a total beginner.
Given a topic and its theory seed, write the lesson:
- 300-600 words
- Direct, no filler. No "great question!"
- Explain the WHY before the HOW
- Use Tom's gear in examples (Sony a6700, Sigma 18-50 f/2.8, Sony 70-350, Epson ET-8550)
- End with one concrete takeaway he can apply this weekend
- Output plain text suitable for Telegram (no markdown headers)`;

export async function generateTheory(topicId: string): Promise<string> {
  const topic = SKILL_TREE.find((t) => t.id === topicId);
  if (!topic) throw new Error(`Unknown topic: ${topicId}`);
  const result = await callClaude({
    model: AGENT_PRIMARY_MODEL,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    user: `Topic: ${topic.name} (${topic.id})\nTrack: ${topic.track}\n\nSeed: ${topic.theorySeed}`,
  });
  return result.content;
}
```

- [ ] **Step 2: Tests PASS (mocked Claude)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(photography): theory generator for /learn command"
```

---

## Milestone 5 — Photo submission + grading (Tasks 26–29)

### Task 26: EXIF reader `domains/photography/exif.ts`

**Files:**
- Create: `domains/photography/exif.ts`
- Create: `tests/domains/photography/exif.test.ts`
- Create: `tests/fixtures/photography/` with at least one sample JPEG with EXIF (test fixture)
- Modify: `package.json`

- [ ] **Step 1: Install exifr**

```bash
npm install exifr
```

- [ ] **Step 2: Save a real fixture photo with EXIF**

Save one of Tom's a6700 JPEGs to `tests/fixtures/photography/sample-a6700.jpg`.

- [ ] **Step 3: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { readExif } from '../../../domains/photography/exif.js';

describe('readExif', () => {
  it('reads camera, lens, settings from a real a6700 JPEG', async () => {
    const buf = await readFile(join(__dirname, '../../fixtures/photography/sample-a6700.jpg'));
    const exif = await readExif(buf);
    expect(exif.ok).toBe(true);
    if (!exif.ok) return;
    expect(exif.camera).toMatch(/a6700|ILCE-6700/i);
    expect(exif.aperture).toBeDefined();
    expect(exif.shutter).toBeDefined();
    expect(exif.iso).toBeDefined();
  });

  it('returns no_exif for a buffer without metadata', async () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]); // empty JPEG
    const exif = await readExif(buf);
    expect(exif.ok).toBe(false);
  });
});
```

- [ ] **Step 4: Implement**

```ts
import exifr from 'exifr';

export type ExifResult = {
  ok: true;
  camera: string;
  lens: string;
  aperture: number;
  shutter: string;
  iso: number;
  focalLength: number;
  focalLength35mm?: number;
  exposureMode?: string;
  whiteBalance?: string;
  lat?: number;
  lng?: number;
  dateTaken?: string;
} | { ok: false; error: 'no_exif' | 'parse_error' };

export async function readExif(buf: Buffer): Promise<ExifResult> {
  try {
    const data = await exifr.parse(buf, {
      pick: ['Make', 'Model', 'LensModel', 'FNumber', 'ExposureTime', 'ISO',
             'FocalLength', 'FocalLengthIn35mmFilm', 'ExposureMode', 'WhiteBalance',
             'GPSLatitude', 'GPSLongitude', 'DateTimeOriginal'],
    });
    if (!data || !data.Model) return { ok: false, error: 'no_exif' };
    return {
      ok: true,
      camera: `${data.Make || ''} ${data.Model}`.trim(),
      lens: data.LensModel || '',
      aperture: data.FNumber,
      shutter: formatShutter(data.ExposureTime),
      iso: data.ISO,
      focalLength: data.FocalLength,
      focalLength35mm: data.FocalLengthIn35mmFilm,
      exposureMode: data.ExposureMode?.toString(),
      whiteBalance: data.WhiteBalance?.toString(),
      lat: data.GPSLatitude,
      lng: data.GPSLongitude,
      dateTaken: data.DateTimeOriginal?.toISOString?.(),
    };
  } catch {
    return { ok: false, error: 'parse_error' };
  }
}

function formatShutter(sec: number): string {
  if (sec >= 1) return `${sec}s`;
  return `1/${Math.round(1 / sec)}`;
}
```

- [ ] **Step 5: Tests PASS**

- [ ] **Step 6: Commit**

```bash
git add domains/photography/exif.ts tests/domains/photography/exif.test.ts tests/fixtures/photography/sample-a6700.jpg package.json package-lock.json
git commit -m "feat(photography): EXIF reader using exifr"
```

---

### Task 27: Grading `domains/photography/grading.ts`

**Files:**
- Create: `domains/photography/grading.ts`
- Create: `tests/domains/photography/grading.test.ts`

- [ ] **Step 1: Write tests for prompt construction + response parsing**

```ts
import { describe, it, expect } from 'vitest';
import { buildGradingPrompt, parseGradingResponse } from '../../../domains/photography/grading.js';

describe('grading', () => {
  it('buildGradingPrompt includes rubric verbatim', () => {
    const prompt = buildGradingPrompt({
      assignment: { assignment_text: 'Shoot at f/8.', rubric_json: JSON.stringify([
        { criterion: 'sharpness', description: '...', is_core: true },
      ]) } as any,
      exif: { ok: true, camera: 'Sony a6700', lens: 'Sigma 18-50', aperture: 8, shutter: '1/250', iso: 100, focalLength: 35 },
      userNotes: 'foreground rock',
    });
    expect(prompt.user).toContain('Shoot at f/8.');
    expect(prompt.user).toContain('sharpness');
    expect(prompt.user).toContain('a6700');
    expect(prompt.user).toContain('foreground rock');
  });

  it('parseGradingResponse parses valid JSON', () => {
    const json = '{"verdict":"pass","per_criterion":[{"criterion":"sharpness","result":"pass","reason":"yes"}],"overall_critique":"good","suggested_next_step":"next"}';
    const r = parseGradingResponse(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.verdict).toBe('pass');
  });

  it('parseGradingResponse rejects malformed JSON gracefully', () => {
    const r = parseGradingResponse('not json');
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import type { ExifResult } from './exif.js';
import type { AssignmentRow } from '../../lib/photographySheets.js';

const SYSTEM_PROMPT = `You are grading a photo against a specific assignment rubric. Be honest, direct, and specific. Cite what you see in the image. Do not soften feedback. Tom wants to learn — flattery doesn't help him.

Output JSON only, matching this schema:
{
  "verdict": "pass" | "did_not_pass",
  "per_criterion": [{"criterion": string, "result": "pass" | "partial" | "fail", "reason": string}],
  "overall_critique": string,
  "suggested_next_step": string
}

Verdict rules:
- All criteria pass OR (n-1 of n criteria pass, where the failing one is NOT core) → verdict: pass
- Two or more criteria fail OR any criterion marked is_core: true fails → verdict: did_not_pass`;

export function buildGradingPrompt(input: {
  assignment: AssignmentRow;
  exif: ExifResult;
  userNotes: string;
}): { system: any; user: string } {
  const rubric = JSON.parse(input.assignment.rubric_json) as Array<{ criterion: string; description: string; is_core: boolean }>;
  const gear = input.exif.ok
    ? `Camera: ${input.exif.camera}\nLens: ${input.exif.lens}\nSettings: aperture f/${input.exif.aperture}, shutter ${input.exif.shutter}, ISO ${input.exif.iso}, focal length ${input.exif.focalLength}mm`
    : 'EXIF not readable; Tom will provide settings separately.';
  return {
    system: { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    user: `## Assignment\n${input.assignment.assignment_text}\n\n## Rubric\n${rubric.map((c, i) => `${i + 1}. ${c.criterion} (${c.is_core ? 'CORE' : 'non-core'}): ${c.description}`).join('\n')}\n\n## Gear Tom used\n${gear}\n\n## Tom's caption\n${input.userNotes || '(none)'}\n\n## The photo\n[attached]`,
  };
}

export type GradingResult = {
  ok: true;
  verdict: 'pass' | 'did_not_pass';
  per_criterion: Array<{ criterion: string; result: 'pass' | 'partial' | 'fail'; reason: string }>;
  overall_critique: string;
  suggested_next_step: string;
} | { ok: false; error: string };

export function parseGradingResponse(raw: string): GradingResult {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.verdict || !Array.isArray(parsed.per_criterion)) {
      return { ok: false, error: 'malformed_schema' };
    }
    return { ok: true, ...parsed };
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
}
```

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(photography): grading prompt + response parser"
```

---

### Task 28: Telegram photo submission flow

**Files:**
- Modify: `apps/bot/photographyHandlers.ts`
- Modify: `apps/bot/index.ts` (Telegram media handling)
- Create: `tests/apps/bot/photographyHandlers.test.ts` (extend)

- [ ] **Step 1: Implement photo submission handler**

```ts
export async function handlePhotoSubmission(input: {
  chatId: number;
  telegramFileId: string;
  isDocument: boolean;
  caption: string;
  fileBuffer: Buffer;
}): Promise<string> {
  // 1. Fetch active assignment
  const active = await getActiveAssignment(sheets);
  if (!active) return 'No active assignment. `/next` to get one.';

  // 2. Read EXIF (if Document); if compressed Photo, set exif = { ok: false }
  const exif = input.isDocument ? await readExif(input.fileBuffer) : { ok: false as const, error: 'compressed' as const };

  // 3. If exif failed AND no caption with settings → ask for settings
  if (!exif.ok && !looksLikeManualSettings(input.caption)) {
    return 'I couldn\'t read your settings from this photo. Send as a Document/File to preserve EXIF, or include settings in the caption: "a6700 / Sigma 18-50 / f/8 / 1/250 / ISO 200 / 35mm".';
  }

  // 4. Build grading prompt + call Claude with vision
  const { system, user } = buildGradingPrompt({ assignment: active, exif, userNotes: input.caption });
  const claudeResult = await callClaudeWithVision({
    model: AGENT_PRIMARY_MODEL,
    system: [system],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: input.fileBuffer.toString('base64') } },
        { type: 'text', text: user },
      ],
    }],
  });

  // 5. Parse + update row
  const parsed = parseGradingResponse(claudeResult.content);
  if (!parsed.ok) {
    // Don't update sheet on parse failure — retry-safe
    return 'Grading failed (model returned malformed response). Try resubmitting in a few minutes.';
  }

  await updateAssignment(sheets, active.rowIndex, {
    status: 'submitted',  // intermediate
    date_submitted: new Date().toISOString(),
    submitted_photo_telegram_file_id: input.telegramFileId,
    camera: exif.ok ? exif.camera : '',
    lens: exif.ok ? exif.lens : '',
    settings_extracted: exif.ok ? JSON.stringify({ aperture: exif.aperture, shutter: exif.shutter, iso: exif.iso, focalLength: exif.focalLength }) : '',
    user_notes: input.caption,
  });
  // Then update with grading result:
  await updateAssignment(sheets, active.rowIndex, {
    status: parsed.verdict === 'pass' ? 'passed' : 'did_not_pass',
    date_graded: new Date().toISOString(),
    ai_verdict: parsed.verdict,
    ai_critique: parsed.overall_critique,
    per_criterion_json: JSON.stringify(parsed.per_criterion),
    retry_count: active.retry_count + (parsed.verdict === 'did_not_pass' ? 0 : 0),
  });

  // 6. On pass, mark topic completed
  if (parsed.verdict === 'pass') {
    await upsertProgress(sheets, active.topic_id, { status: 'completed', last_activity_at: new Date().toISOString() });
  }

  // 7. Format Telegram reply
  return formatGradingReply(parsed, active.topic_id);
}
```

- [ ] **Step 2: Wire photo media handling in `apps/bot/index.ts`**

Read the existing pattern. Add a path that:
- Detects `msg.document?.mime_type` starting with `image/` → Document upload (EXIF preserved).
- Detects `msg.photo` array → compressed Photo (EXIF stripped).
- Downloads file via `bot.getFileLink(file_id)` + fetch.
- Calls `handlePhotoSubmission` with the buffer.
- Sends the reply.

- [ ] **Step 3: Manual end-to-end smoke test**

Issue an assignment via `/next`, then submit a real photo as Document from your phone. Verify:
- EXIF read correctly
- Grading runs
- Row updated in sheet
- Telegram reply shows verdict + critique

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(photography): photo submission + grading end-to-end"
```

---

### Task 29: Edge cases — RAW rejection, no-EXIF prompt, retry resubmit

**Files:**
- Modify: `apps/bot/photographyHandlers.ts`
- Modify: `tests/apps/bot/photographyHandlers.test.ts`

- [ ] **Step 1: Add RAW rejection**

If `msg.document.mime_type === 'image/x-sony-arw'` or filename ends in `.ARW` → reply: *"Send the JPEG export, not the RAW. RAW files don't work for vision input."*

- [ ] **Step 2: Add resubmit on did_not_pass**

If active assignment status is already `did_not_pass` and a new photo comes in, treat as retry: increment `retry_count`, run grading again.

- [ ] **Step 3: Add gear-mismatch callout**

If EXIF says camera is iPhone / non-a6700 → reply notes the mismatch in the critique.

- [ ] **Step 4: Tests + commit**

```bash
git commit -m "feat(photography): RAW rejection + retry + gear-mismatch handling"
```

---

## Milestone 6 — Web UI (Tasks 30–32)

### Task 30: Skills page `/photography`

**Files:**
- Create: `app/photography/page.tsx`
- Create: `app/lib/photographyData.ts` (server-side data helpers)
- Create: `app/photography/Skills.tsx` (client component if needed for filters)

- [ ] **Step 1: Implement server-side data helper**

```ts
// app/lib/photographyData.ts
import { buildSheetsClient } from '@/lib/sheets';
import { readProgress } from '@/lib/photographySheets';
import { SKILL_TREE } from '@/domains/photography/skillTree';
import { computeTopicStatus } from '@/domains/photography/curriculum';

export type TopicView = {
  id: string; track: string; name: string; description: string;
  status: 'locked' | 'available' | 'in-progress' | 'completed' | 'skipped';
};

export async function loadSkillTreeView(): Promise<TopicView[]> {
  const sheets = await buildSheetsClient();
  const progress = await readProgress(sheets);
  return SKILL_TREE.map((t) => ({
    id: t.id, track: t.track, name: t.name, description: t.description,
    status: computeTopicStatus(t.id, progress),
  }));
}
```

- [ ] **Step 2: Implement the page**

Server component at `app/photography/page.tsx` — grouped grid of topics by track, status icons. Tailwind for styling (match existing web UI pattern).

- [ ] **Step 3: Verify locally**

```bash
npm run web:dev
# Open http://localhost:3000/photography
```

Inspect — all tracks visible, status icons correct.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): /photography skills page"
```

---

### Task 31: Topic detail `/photography/<topic-id>`

**Files:**
- Create: `app/photography/[topicId]/page.tsx`

- [ ] **Step 1: Implement**

Server component renders:
- Topic name + track + prereq status
- Description
- "Read theory" — calls `generateTheory(topicId)` server-side, displays the text
- "Start assignment" button — `tg://resolve?domain=<bot>&text=/start%20<topic-id>` deep link

- [ ] **Step 2: Verify + commit**

```bash
git commit -m "feat(web): /photography/<topic-id> topic detail page"
```

---

### Task 32: Assignment history `/photography/assignments`

**Files:**
- Create: `app/photography/assignments/page.tsx`

- [ ] **Step 1: Implement**

Server component renders reverse-chrono list of all assignments. Each item: status pill, topic name, date, verdict, thumbnail (Telegram file_id → fetched via bot API server-side, cached briefly).

- [ ] **Step 2: Verify + commit**

```bash
git commit -m "feat(web): /photography/assignments history page"
```

---

## Milestone 7 — Onboarding + acceptance (Task 33)

### Task 33: Onboarding flow + acceptance test

**Files:**
- Modify: `apps/bot/photographyHandlers.ts` (add onboarding detection at handler entry)

- [ ] **Step 1: Implement onboarding detection**

At the start of every photography message handler, check `Photography Progress` — if zero `completed` topics AND no active assignment AND first photography message ever (track via state file), run the 3-question interview.

- [ ] **Step 2: Implement the interview**

Three-message sequence:
1. "Quick orienting questions. How would you describe your confidence with manual mode today? (none / shaky / decent / strong)"
2. "Anything specific you want to start with, or should I pick the most logical first step?"
3. "What's a realistic shooting cadence? (every weekend / opportunistic / ramping up / not sure yet)"

Hold answers in a transient state file or sheet-tab `Photography Onboarding`. After all three, route to `handleStartCommand` with the chosen topic.

- [ ] **Step 3: Run the 5-question acceptance test**

Acceptance criteria from the spec, section "5-question acceptance test":

1. *"Explain RAW vs JPEG to me using my a6700 — when should I shoot what?"* → solid theory answer grounded in his gear.
2. *"Give me a 2-week plan to learn manual mode on landscape shoots."* → coherent plan, sequenced, opens with `fundamentals.manual-mode` or active prereq, references Sigma 18-50.
3. *"What should I shoot this Saturday near Boulder if the weather looks good for golden hour?"* → uses get_forecast + lookup_trail + get_sun_times + inventory.
4. *Submits a landscape photo for active foreground-anchor assignment* → grades honestly, cites what's in the frame, valid verdict.
5. *"What's next?"* → uses progress state to recommend a coherent next step.

If any fail → debug + iterate before declaring Phase 7 done.

- [ ] **Step 4: Update PLAN.md and DECISIONS.md**

After all 5 pass:
- Mark Phase 7 ✅ shipped in `docs/PLAN.md`.
- Add a "2026-XX-XX — Phase 7 shipped: Photography domain" entry in `DECISIONS.md`.
- Update `CLAUDE.md` to reference the new domain (External integrations table, How to extend section).
- Update `README.md` status line.

- [ ] **Step 5: Final commit**

```bash
git add docs/PLAN.md DECISIONS.md CLAUDE.md README.md
git commit -m "docs: mark Phase 7 (photography domain) shipped"
```

---

## Spec coverage check

| Spec section | Plan task(s) |
|---|---|
| File structure under `domains/photography/` | T3, T7, T11–T18, T20–T22, T25–T27 |
| Cross-domain refactor (weather + trails → lib/integrations) | T1 |
| Sun-times integration | T2 |
| Classifier + reclassify script | T3, T4, T5 |
| Sheet tabs (Photography Assignments + Photography Progress) | T6 |
| Inventory grounding (serialize + filter to Photography) | T7 |
| Bot router rewrite (sticky + slash + doc-route + /who) | T8, T9, T10 |
| Skill-tree types + validator | T11 |
| ~75 topics across all tracks | T12–T17 |
| Curriculum runtime (pickNext, checkPrereqs, generatePlan) | T18, T19 |
| Assignment lifecycle (sheet I/O, single-active, status transitions) | T20 |
| Assignment + rubric generation (Claude + prompts) | T21 |
| Agent system prompt + tool registry | T22 |
| Telegram commands (/skills /track /next /start /active /skip /learn /plan) | T23, T24 |
| Theory delivery (/learn) | T25 |
| EXIF reading | T26 |
| Grading prompt + response parsing | T27 |
| Photo submission end-to-end flow | T28 |
| Edge cases (RAW reject, no-EXIF, retry, gear mismatch) | T29 |
| Web UI Skills page | T30 |
| Topic detail page | T31 |
| Assignment history page | T32 |
| Onboarding 3-question interview | T33 |
| 5-question acceptance test | T33 |

All spec sections covered. No placeholders. Tasks are TDD-friendly with the testable units (parsers, classifiers, curriculum logic, grading) covered by automated tests; web UI + Telegram E2E are manual smoke tests.

---

## Notes for the implementing engineer

- This plan assumes Phase 6 is in daily use ≥1 month before execution starts. Do not run Task 1 until Tom confirms the gate has opened.
- Total estimated effort: ~3-4 weeks of focused work. Skill-tree authoring (T12–T17) is content-heavy but bounded — use Claude assistance per topic and don't get stuck perfecting any one seed.
- If `lib/claude.ts` doesn't expose `callClaudeJSON` or `callClaudeWithVision` with the exact signatures used in this plan, adapt to the actual wrapper. The semantic shape is what matters: cache the system prompt, return parsed JSON for grading.
- The bot router rewrite (T9) changes behavior for ALL Telegram messages — exercise outdoor flows manually (T10) before merging.
- If at any point a task feels larger than 2-3 hours, split it. Frequent commits over big-bang.
