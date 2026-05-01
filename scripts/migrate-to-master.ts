import 'dotenv/config';
import { google, sheets_v4 } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseDate, isValid } from 'date-fns';

const HAIKU_MODEL = 'claude-haiku-4-5';
const TARGET_TAB = 'All Purchases';
const REI_TAB = 'REI All Purchases';
const AMAZON_TAB = 'Amazon Purchases';
const CONCURRENCY = parseInt(process.env.MIGRATE_CONCURRENCY ?? '3', 10);
const MAX_RETRIES = 5;
const SAMPLE_SIZE = 8;

const STATUS_VALUES = [
  'active',
  'retired',
  'returned',
  'lost',
  'broken',
  'sold',
  'donated',
  'excluded',
] as const;
type Status = (typeof STATUS_VALUES)[number];
type Domain = 'Outdoor' | 'Other';

interface MasterRow {
  year: string;
  date: string;
  category: string;
  subCategory: string;
  brand: string;
  itemName: string;
  color: string;
  size: string;
  qty: number;
  price: number;
  source: 'REI' | 'Amazon';
  orderId: string;
  status: Status;
  domain: Domain;
  productUrl: string;
}

interface ClassifyResult {
  domain: Domain;
  category: string;
  subCategory: string;
  brand: string;
}

interface Vocab {
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
  brands: string[];
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', enum: ['Outdoor', 'Other'] },
    category: { type: 'string' },
    subCategory: { type: 'string' },
    brand: { type: 'string' },
  },
  required: ['domain', 'category', 'subCategory', 'brand'],
  additionalProperties: false,
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`Mode: ${apply ? 'APPLY (writes will be made)' : 'DRY RUN (no writes)'}\n`);

  const env = readEnv();
  const oauth2Client = new google.auth.OAuth2(env.clientId, env.clientSecret);
  oauth2Client.setCredentials({ refresh_token: env.refreshToken });
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const anthropic = new Anthropic({ apiKey: env.anthropicKey });

  console.log('Inspecting spreadsheet...');
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: env.spreadsheetId,
    fields: 'properties.title,sheets(properties(sheetId,title))',
  });
  const allTabs = meta.data.sheets ?? [];
  const tabNames = allTabs.map((s) => s.properties?.title ?? '');
  console.log(`✓ Spreadsheet: "${meta.data.properties?.title}"`);
  console.log(`  Tabs: ${tabNames.map((n) => `"${n}"`).join(', ')}\n`);

  if (!tabNames.includes(REI_TAB) || !tabNames.includes(AMAZON_TAB)) {
    console.error(`✗ Required source tabs not found. Need "${REI_TAB}" and "${AMAZON_TAB}".`);
    process.exit(1);
  }

  if (tabNames.includes(TARGET_TAB)) {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: env.spreadsheetId,
      range: `'${TARGET_TAB}'!A1:A2`,
    });
    const hasData = ((existing.data.values ?? []).flat().filter(Boolean).length) > 0;
    if (hasData) {
      console.error(`✗ Target tab "${TARGET_TAB}" already exists with data.`);
      console.error(`  To re-migrate, delete the "${TARGET_TAB}" tab in the sheet first, then re-run.`);
      process.exit(1);
    }
  }

  console.log(`Reading "${REI_TAB}"...`);
  const reiRaw = await readTabRows(sheets, env.spreadsheetId, REI_TAB);
  console.log(`✓ ${reiRaw.length} REI rows`);
  console.log(`Reading "${AMAZON_TAB}"...`);
  const amazonRaw = await readTabRows(sheets, env.spreadsheetId, AMAZON_TAB);
  console.log(`✓ ${amazonRaw.length} Amazon rows\n`);

  const reiRows = reiRaw.map(mapReiRow).filter((r): r is MasterRow => r !== null);
  console.log(`Mapped ${reiRows.length} REI rows directly (no LLM).`);
  const reiSkipped = reiRaw.length - reiRows.length;
  if (reiSkipped > 0) {
    console.log(`  (${reiSkipped} REI rows skipped — missing required fields)`);
  }

  const vocab = buildVocab(reiRows);
  console.log(
    `Built REI vocabulary: ${vocab.categories.length} categories, ` +
      `${Object.values(vocab.subCategoriesByCategory).flat().length} sub-categories, ` +
      `${vocab.brands.length} brands.\n`,
  );

  console.log(`Classifying ${amazonRaw.length} Amazon rows via ${HAIKU_MODEL}...`);
  console.log(`  Concurrency: ${CONCURRENCY}, prompt caching: enabled`);
  const start = Date.now();
  const cacheStats = { creation: 0, reads: 0, uncached: 0 };
  const amazonRows = await classifyAmazonRows(anthropic, amazonRaw, vocab, cacheStats);
  const wallTime = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✓ Classified ${amazonRows.length} Amazon rows in ${wallTime}s`);
  console.log(
    `  Cache: ${cacheStats.creation} write tokens, ${cacheStats.reads} read tokens, ${cacheStats.uncached} uncached input tokens`,
  );
  if (cacheStats.reads === 0 && amazonRows.length > 5) {
    console.log(
      '  (Note: no cache reads — system prompt is below the 4096-token Haiku threshold. Negligible cost impact.)',
    );
  }

  const allRows = [...reiRows, ...amazonRows].sort((a, b) => a.date.localeCompare(b.date));
  console.log(`\nMerged total: ${allRows.length} rows (${reiRows.length} REI + ${amazonRows.length} Amazon)\n`);

  printDistribution(allRows);
  printSamples(allRows);

  if (!apply) {
    console.log('\nDry run complete. Re-run with `--apply` to actually write to the sheet.');
    console.log('  Tip: open the sheet first → File → Version history → Name current version.');
    return;
  }

  console.log('\nApplying...');
  const targetSheetId = await ensureTargetTab(sheets, env.spreadsheetId, allTabs);
  console.log(`✓ Target tab "${TARGET_TAB}" ready (sheetId=${targetSheetId})`);
  await writeMasterRows(sheets, env.spreadsheetId, allRows);
  console.log(`✓ Wrote ${allRows.length} rows + header to "${TARGET_TAB}"`);
  console.log('\nDone. Next: `npm run bootstrap-sheet` to install validation + formatting on the new tab.');
}

function readEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
  anthropicKey: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const missing = [
    ['GOOGLE_CLIENT_ID', clientId],
    ['GOOGLE_CLIENT_SECRET', clientSecret],
    ['GOOGLE_REFRESH_TOKEN', refreshToken],
    ['GOOGLE_SHEET_ID', spreadsheetId],
    ['ANTHROPIC_API_KEY', anthropicKey],
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
    spreadsheetId: spreadsheetId!,
    anthropicKey: anthropicKey!,
  };
}

async function readTabRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<string[][]> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A2:Z`,
  });
  return ((resp.data.values ?? []) as string[][]).filter((row) => row.some((cell) => cell));
}

function mapReiRow(row: string[]): MasterRow | null {
  // REI cols: A=Year B=Date C=Exclude D=Category E=Sub-Category F=Brand G=Item Name H=Color I=Size J=Qty K=Price
  const itemName = (row[6] ?? '').trim();
  if (!itemName) return null;

  const date = parseFlexibleDate(row[1] ?? '');
  if (!date) return null;
  const year = (row[0] ?? date.slice(0, 4)).toString().trim();

  const status: Status = (row[2] ?? '').trim().toLowerCase() === 'yes' ? 'excluded' : 'active';

  return {
    year,
    date,
    category: (row[3] ?? '').trim(),
    subCategory: (row[4] ?? '').trim(),
    brand: (row[5] ?? '').trim(),
    itemName,
    color: (row[7] ?? '').trim(),
    size: (row[8] ?? '').trim(),
    qty: parseQty(row[9] ?? '1'),
    price: parsePrice(row[10] ?? ''),
    source: 'REI',
    orderId: '',
    status,
    domain: 'Outdoor',
    productUrl: '',
  };
}

function parseFlexibleDate(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const formats = ['MMM d, yyyy', 'MMMM d, yyyy', 'M/d/yyyy', 'yyyy-MM-dd', 'M/d/yy'];
  for (const fmt of formats) {
    const d = parseDate(trimmed, fmt, new Date());
    if (isValid(d)) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

function parsePrice(s: string): number {
  const cleaned = s.replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseQty(s: string): number {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function buildVocab(reiRows: MasterRow[]): Vocab {
  const categoriesSet = new Set<string>();
  const subByCategory: Record<string, Set<string>> = {};
  const brandsSet = new Set<string>();
  for (const r of reiRows) {
    if (r.category) {
      categoriesSet.add(r.category);
      if (!subByCategory[r.category]) subByCategory[r.category] = new Set();
      if (r.subCategory) subByCategory[r.category]!.add(r.subCategory);
    }
    if (r.brand) brandsSet.add(r.brand);
  }
  const subCategoriesByCategory: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(subByCategory)) {
    subCategoriesByCategory[k] = [...v].sort();
  }
  return {
    categories: [...categoriesSet].sort(),
    subCategoriesByCategory,
    brands: [...brandsSet].sort(),
  };
}

function buildSystemPrompt(vocab: Vocab): string {
  const categoriesBlock = vocab.categories
    .map((c) => {
      const subs = vocab.subCategoriesByCategory[c] ?? [];
      return `  - "${c}"${subs.length > 0 ? ` → sub-categories: ${subs.map((s) => `"${s}"`).join(', ')}` : ''}`;
    })
    .join('\n');
  const brandsBlock = vocab.brands.map((b) => `  - "${b}"`).join('\n');
  return `You are a categorization assistant for a personal purchase-inventory system. Tom buys outdoor gear from REI and a wide range of items from Amazon. Your job is to assign four fields to each Amazon line item so it merges cleanly with his existing REI data:

1. **domain**: "Outdoor" or "Other".
   - "Outdoor" = anything used for hiking, backpacking, camping, mountain biking, climbing, skiing/snowboarding, paddling, surfing, trail running, or other outdoor activities. Includes outdoor-specific clothing, footwear, gear, accessories, and outdoor-leaning electronics like GPS watches, headlamps, action cameras used outdoors.
   - "Other" = everything else: kitchen, home, photography, books, electronics not used outdoors, clothing not for outdoor activities, household supplies, etc. When unsure between Outdoor and Other, prefer "Other" — it's reclassified later, while a wrong "Outdoor" pollutes the inventory.

2. **category**: top-level category. Prefer the existing REI vocabulary below; only invent a new category if NOTHING in the list reasonably fits. New categories should follow the same naming style (Title Case, descriptive).

3. **subCategory**: finer grain within the category. If the chosen category has known sub-categories below, use one of them when applicable. Leave as "" (empty string) if no sub-category applies or none is obvious.

4. **brand**: extract the brand from the item name when clearly identifiable (e.g. "Patagonia R1 Hoody" → "Patagonia"). If no brand is recognizable, return "" (empty string). Prefer the brand list below when matching.

## Existing REI category taxonomy

${categoriesBlock || '  (none)'}

## Existing brands seen in REI data

${brandsBlock || '  (none)'}

## Examples

- Amazon item "Peak Design Capture Camera Clip V3, Black" with Amazon category "Camera & Photography":
  → domain="Other", category="Camera & Photography" or similar (new), subCategory="", brand="Peak Design"
- Amazon item "Black Diamond Spot 400 Headlamp" with Amazon category "Sports & Outdoors":
  → domain="Outdoor", category="Camping Gear" (or whatever REI category fits), subCategory="Headlamp", brand="Black Diamond"
- Amazon item "Smartwool Merino 250 Base Layer Top - Men's M" with Amazon category "Clothing":
  → domain="Outdoor", category="Outdoor Clothing" or similar, subCategory="Base Layer", brand="Smartwool"
- Amazon item "Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart" with Amazon category "Kitchen":
  → domain="Other", category="Kitchen" (new), subCategory="", brand="Instant Pot"

Return ONLY the four fields. Do not narrate.`;
}

async function classifyAmazonRows(
  anthropic: Anthropic,
  rawRows: string[][],
  vocab: Vocab,
  cacheStats: { creation: number; reads: number; uncached: number },
): Promise<MasterRow[]> {
  const systemPrompt = buildSystemPrompt(vocab);
  const results: MasterRow[] = new Array(rawRows.length);

  for (let batchStart = 0; batchStart < rawRows.length; batchStart += CONCURRENCY) {
    const batch = rawRows.slice(batchStart, batchStart + CONCURRENCY);
    await Promise.all(
      batch.map(async (row, i) => {
        const idx = batchStart + i;
        const mapped = await classifyOneAmazonRow(anthropic, row, systemPrompt, cacheStats);
        if (mapped) results[idx] = mapped;
      }),
    );
    process.stdout.write(`  ${Math.min(batchStart + CONCURRENCY, rawRows.length)}/${rawRows.length}\r`);
  }
  process.stdout.write('\n');

  return results.filter((r): r is MasterRow => !!r);
}

async function classifyOneAmazonRow(
  anthropic: Anthropic,
  row: string[],
  systemPrompt: string,
  cacheStats: { creation: number; reads: number; uncached: number },
): Promise<MasterRow | null> {
  // Amazon cols: A=Year B=Date C=Category D=Item Name E=Unit Price F=Quantity G=Order ID
  const itemName = (row[3] ?? '').trim();
  if (!itemName) return null;

  const date = parseFlexibleDate(row[1] ?? '');
  if (!date) return null;
  const year = (row[0] ?? date.slice(0, 4)).toString().trim();
  const amazonCategory = (row[2] ?? '').trim();
  const orderId = (row[6] ?? '').trim().replace(/^'/, '');

  const userMessage = `Classify this Amazon line item:
- Item name: "${itemName}"
- Amazon's own category: "${amazonCategory || '(none provided)'}"

Return the four fields.`;

  const resp = await callWithRetry(() =>
    anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
      output_config: {
        format: { type: 'json_schema', schema: CLASSIFY_SCHEMA },
      },
    }),
  );

  cacheStats.creation += resp.usage.cache_creation_input_tokens ?? 0;
  cacheStats.reads += resp.usage.cache_read_input_tokens ?? 0;
  cacheStats.uncached += resp.usage.input_tokens;

  const textBlock = resp.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  if (!textBlock) {
    console.warn(`\n  ⚠ No text response for "${itemName}" — leaving as Other`);
    return amazonRowFallback(itemName, year, date, amazonCategory, orderId, row);
  }

  let parsed: ClassifyResult;
  try {
    parsed = JSON.parse(textBlock.text) as ClassifyResult;
  } catch {
    console.warn(`\n  ⚠ Invalid JSON for "${itemName}" — leaving as Other`);
    return amazonRowFallback(itemName, year, date, amazonCategory, orderId, row);
  }

  return {
    year,
    date,
    category: parsed.category || amazonCategory || 'Uncategorized',
    subCategory: parsed.subCategory || '',
    brand: parsed.brand || '',
    itemName,
    color: '',
    size: '',
    qty: parseQty(row[5] ?? '1'),
    price: parsePrice(row[4] ?? ''),
    source: 'Amazon',
    orderId,
    status: 'active',
    domain: parsed.domain,
    productUrl: '',
  };
}

async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isRetryable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError ||
        (err instanceof Anthropic.APIError && err.status === 529);
      if (!isRetryable || attempt === MAX_RETRIES - 1) throw err;
      const delayMs = Math.min(1000 * 2 ** attempt, 30000) + Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

function amazonRowFallback(
  itemName: string,
  year: string,
  date: string,
  amazonCategory: string,
  orderId: string,
  row: string[],
): MasterRow {
  return {
    year,
    date,
    category: amazonCategory || 'Uncategorized',
    subCategory: '',
    brand: '',
    itemName,
    color: '',
    size: '',
    qty: parseQty(row[5] ?? '1'),
    price: parsePrice(row[4] ?? ''),
    source: 'Amazon',
    orderId,
    status: 'active',
    domain: 'Other',
    productUrl: '',
  };
}

function printDistribution(rows: MasterRow[]): void {
  const bySource: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }
  console.log('Distribution:');
  console.log(`  By source: ${JSON.stringify(bySource)}`);
  console.log(`  By domain: ${JSON.stringify(byDomain)}`);
  console.log(`  By status: ${JSON.stringify(byStatus)}`);
}

function printSamples(rows: MasterRow[]): void {
  const reiRows = rows.filter((r) => r.source === 'REI');
  const amazonOutdoor = rows.filter((r) => r.source === 'Amazon' && r.domain === 'Outdoor');
  const amazonOther = rows.filter((r) => r.source === 'Amazon' && r.domain === 'Other');
  console.log(`\nSample rows (eyeball Haiku's classifications):`);
  console.log('\n  -- REI sample (direct mapping) --');
  pickRandom(reiRows, 3).forEach((r) => printRow(r));
  console.log('\n  -- Amazon Outdoor (Haiku) --');
  pickRandom(amazonOutdoor, 3).forEach((r) => printRow(r));
  console.log('\n  -- Amazon Other (Haiku) --');
  pickRandom(amazonOther, SAMPLE_SIZE - 6).forEach((r) => printRow(r));
}

function pickRandom<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  const used = new Set<number>();
  while (out.length < n && used.size < arr.length) {
    const i = Math.floor(Math.random() * arr.length);
    if (!used.has(i)) {
      used.add(i);
      out.push(arr[i]!);
    }
  }
  return out;
}

function printRow(r: MasterRow): void {
  console.log(
    `    ${r.date} | ${r.source.padEnd(6)} | ${r.domain.padEnd(7)} | ${r.status.padEnd(8)} | "${r.itemName.slice(0, 60)}"`,
  );
  console.log(
    `      → category="${r.category}", subCategory="${r.subCategory}", brand="${r.brand}", price=$${r.price.toFixed(2)}`,
  );
}

async function ensureTargetTab(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  allTabs: sheets_v4.Schema$Sheet[],
): Promise<number> {
  const existing = allTabs.find((t) => t.properties?.title === TARGET_TAB);
  if (existing && existing.properties?.sheetId != null) {
    return existing.properties.sheetId;
  }
  const resp = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: TARGET_TAB,
              gridProperties: { rowCount: 1000, columnCount: 15 },
            },
          },
        },
      ],
    },
  });
  const newSheet = resp.data.replies?.[0]?.addSheet?.properties;
  if (!newSheet?.sheetId) throw new Error('Failed to create target tab');
  return newSheet.sheetId;
}

async function writeMasterRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  rows: MasterRow[],
): Promise<void> {
  const headers = [
    'Year',
    'Date Purchased',
    'Category',
    'Sub-Category',
    'Brand',
    'Item Name',
    'Color',
    'Size',
    'Qty',
    'Price (Paid)',
    'Source',
    'Order ID',
    'Status',
    'Domain',
    'Product URL',
  ];
  const values: (string | number)[][] = [
    headers,
    ...rows.map((r) => [
      r.year,
      r.date,
      r.category,
      r.subCategory,
      r.brand,
      r.itemName,
      r.color,
      r.size,
      r.qty,
      r.price,
      r.source,
      r.orderId,
      r.status,
      r.domain,
      r.productUrl,
    ]),
  ];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TARGET_TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

main().catch((err: unknown) => {
  console.error('\n✗ Migration failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
