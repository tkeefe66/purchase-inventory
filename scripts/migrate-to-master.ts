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
const DOMAIN_VALUES = [
  'Outdoor',
  'Photography',
  'Kitchen',
  'Home',
  'Tech',
  'Wardrobe',
  'Auto',
  'Fitness',
  'Health',
  'Media',
  'Other',
] as const;
type Domain = (typeof DOMAIN_VALUES)[number];
type ItemType = 'Gear' | 'Consumable' | 'Service';

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
  type: ItemType;
  reasoning: string;
}

interface ClassifyResult {
  domain: Domain;
  category: string;
  subCategory: string;
  brand: string;
  type: ItemType;
  reasoning: string;
}

interface Vocab {
  categories: string[];
  subCategoriesByCategory: Record<string, string[]>;
  brands: string[];
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', enum: [...DOMAIN_VALUES] },
    type: { type: 'string', enum: ['Gear', 'Consumable', 'Service'] },
    category: { type: 'string' },
    subCategory: { type: 'string' },
    brand: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['domain', 'type', 'category', 'subCategory', 'brand', 'reasoning'],
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

  // REI rows are all-Outdoor by locked decision. Type is inferred from REI's own
  // category — most REI items are gear, but Trail Snacks & Nutrition / Membership
  // get their own treatment. Reasoning stays blank for direct mappings.
  const reiCategory = (row[3] ?? '').trim();
  const itemType: ItemType = inferReiType(reiCategory, itemName);

  return {
    year,
    date,
    category: reiCategory,
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
    type: itemType,
    reasoning: '',
  };
}

function inferReiType(category: string, itemName: string): ItemType {
  const c = category.toLowerCase();
  const n = itemName.toLowerCase();
  if (c.includes('membership') || n.includes('membership')) return 'Service';
  if (
    c.includes('snack') ||
    c.includes('nutrition') ||
    c.includes('food') ||
    c.includes('drink') ||
    c.includes('hydration mix') ||
    c.includes('supplement')
  ) {
    return 'Consumable';
  }
  // Catch consumables hiding in non-consumable-looking REI categories
  // (e.g. "Camping Gear / Kitchen & Cleanup" → dish wipes; "Ski/Snow Gear" → wax).
  const consumableKeywords = [
    'wipes',
    'wipe',
    'fuel',
    ' wax',
    'wax ',
    'cleaner',
    'cleansing',
    'lubricant',
    ' lube',
    'sealant',
    'seal-it',
    'repellent',
    'repellant',
    'polish',
    ' chalk',
    'chalk ',
    'sunscreen',
    'sunblock',
    'lip balm',
    'soap',
    'detergent',
    'first aid',
    'tape ',
    'patch',
  ];
  if (consumableKeywords.some((kw) => n.includes(kw))) return 'Consumable';
  return 'Gear';
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
  return `You are a categorization assistant for a personal purchase-inventory system. Tom is building a multi-domain platform where each domain (outdoor, photography, kitchen, etc.) eventually has its own AI mentor agent. Each agent uses Tom's purchase inventory as grounding to give advice on gear, trip planning, recipes, repurchases, etc.

The categorization assigns six fields per Amazon line item:

---

### 1. **domain** — ONE OF 11 values

Domain answers: *"which expert agent cares about this item — for advice OR for proactive consumable nudges?"* Domain-specific consumables stay in their domain (so the agent can track repurchase needs). The 11 domains:

- **\`Outdoor\`** — Hiking, backpacking, camping, climbing, mountain biking, skiing/snowboarding, paddling, surfing, trail running. Includes outdoor-specific gear (tents, bikes, packs, helmets, base layers, headlamps), outdoor services (REI Membership, race entries, ski lift tickets, bike tune-ups, gym climbing memberships, AllTrails/Strava subscriptions), AND outdoor-specific consumables (climbing chalk, ski wax, energy gels, bear spray, sunscreen for trips, bike chain lube, fuel canisters).

- **\`Photography\`** — Cameras, lenses, tripods, camera bags, lighting, flashes, gimbals, photo editing software/courses, AND photography consumables (camera batteries, memory cards, lens cleaning fluid, sensor swabs).

- **\`Kitchen\`** — Cookware, bakeware, appliances (Instant Pot, blender, mixer), utensils, food storage, AND **all food and drink consumables consumed at home**: cooking ingredients (oil, spices, flour, salt), pantry staples, coffee beans, AND **all home-consumed beverages** (Gatorade, protein shakes, juice, sparkling water, soda, beer — Category="Drinks"). Note: outdoor-trip-specific food (energy gels, freeze-dried meals) goes to Outdoor instead.

- **\`Home\`** — Furniture, bedding, bath, decor, lighting (non-outdoor), DIY/repair tools, vacuums, humidifiers, AND home consumables (dish soap, paper towels, laundry detergent, light bulbs, household batteries, cleaning supplies).

- **\`Tech\`** — Computers, laptops, monitors, keyboards, mice, audio gear (headphones, speakers, mics), networking (router, mesh), smart-home devices, generic electronics, software subscriptions (non-outdoor, non-photography). Apple Watch / general smart watches go here; Garmin Fenix / sport-focused smartwatches go to Outdoor.

- **\`Wardrobe\`** — Casual / dress / work clothing, dress shoes, casual shoes (non-athletic), accessories like watches, belts, wallets, sunglasses (non-outdoor). NOT athletic clothing.

- **\`Auto\`** — Car parts, maintenance, accessories, car-specific tools, motor oil, wiper fluid.

- **\`Fitness\`** — Gym equipment, weights, yoga gear, athletic clothing not specifically outdoor (workout shirts, gym shorts, basketball shoes, treadmill accessories). Athletic clothing where the brand/name doesn't explicitly say hiking/climbing/trail/etc.

- **\`Health\`** — Generic body-care consumables that no specific domain owns: vitamins, supplements (NOT used for outdoor activities), OTC meds, generic toothpaste/shampoo/lotion, generic first aid. Distinct from Outdoor sunscreen and Kitchen drinks — Health is the catchall for body-care that isn't activity-tied.

- **\`Media\`** — Books, magazines, e-books, courses, audiobooks, music subscriptions, video subscriptions.

- **\`Other\`** — TRUE catchall: pet supplies, garden, gifts, hobbies that don't fit a domain. Use sparingly; prefer a specific domain when one fits.

**Anti-patterns to avoid:**

- ❌ Gatorade as Outdoor (Tom drinks it at home, not for trips). ✓ \`Kitchen\` / \`Drinks\` / \`Consumable\`.
- ❌ Vitamins as Outdoor. ✓ \`Health\` / \`Consumable\`.
- ❌ Generic workout shirt as Outdoor. ✓ \`Fitness\` / \`Gear\`.
- ❌ Camera lens as Other. ✓ \`Photography\` / \`Gear\`.
- ❌ Climbing chalk as Health. ✓ \`Outdoor\` / \`Consumable\` (it's outdoor gear that gets consumed; outdoor agent should nudge restocks before climbing season).

**When unsure between two specific domains:** pick the one where a future advisor agent would more obviously use this item. Avoid \`Other\` unless truly nothing fits.

---

### 2. **type** — \`Gear\` | \`Consumable\` | \`Service\`

- **\`Gear\`** = durable owned item. Clothing, equipment, electronics, tools, instruments, accessories that last. Agent's "what do I own?" queries default to Type=Gear.
- **\`Consumable\`** = anything used up over time. Food, drinks, supplements, sunscreen, batteries, chalk, fuel, wax, lubricants, soap, toilet paper. Domain agent's "what am I running low on?" queries.
- **\`Service\`** = memberships, subscriptions, repairs, maintenance, race entries, classes, experiences, software-as-a-service. Anything paid-for but not a physical owned object.

Test for Gear vs Consumable: *"Would buying more of this be a routine restock?"* Yes → Consumable. No → Gear.

---

### 3. **category** — top-level category

Prefer the existing REI vocabulary below. Only invent a new category if nothing fits. For non-outdoor items, invent appropriate categories (Title Case, descriptive). Examples of new categories you might need: "Drinks", "Vitamins & Supplements", "Cleaning Supplies", "Books & Reading", "Cookware", "Camera Accessories", "Personal Care".

### 4. **subCategory**

Finer grain. Use a known REI sub-category when applicable. Leave as \`""\` if no sub-category applies.

### 5. **brand**

Extract from item name when clearly identifiable (e.g. "Patagonia R1 Hoody" → "Patagonia"). Return \`""\` if no brand is recognizable. Prefer the REI brand list when matching.

### 6. **reasoning**

ONE short sentence (≤25 words) explaining domain + type. Examples:
- *"Outdoor-trip food consumed during activities; outdoor agent tracks for trip prep."*
- *"Kitchen pantry staple consumed at home."*
- *"Camera memory card — consumable for photo gear; photo agent tracks."*
- *"Generic vitamin supplement, no specific domain."*

---

## REI category taxonomy (use these when they fit)

${categoriesBlock || '  (none)'}

## REI brand list

${brandsBlock || '  (none)'}

---

## Locked edge-case rulings (must follow exactly)

| Item | domain | type |
|---|---|---|
| Climbing chalk | Outdoor | Consumable |
| Ski wax, edge tuner consumables | Outdoor | Consumable |
| Energy gels, Honey Stinger waffles, trail food | Outdoor | Consumable |
| Bear spray, bug spray for trips | Outdoor | Consumable |
| Sunscreen used for outdoor activities | Outdoor | Consumable |
| Bike chain lube | Outdoor | Consumable |
| Fuel canisters (camping stove) | Outdoor | Consumable |
| Replacement bike tube / tent pole | Outdoor | Gear |
| Headlamp, flashlight (outdoor) | Outdoor | Gear |
| Bikes, helmets, packs, tents, sleeping bags | Outdoor | Gear |
| Camp stove (Jetboil, MSR) | Outdoor | Gear |
| Multitool / Leatherman | Outdoor | Gear |
| Garmin / Suunto sport watch | Outdoor | Gear |
| REI Membership, race entry, ski lift ticket | Outdoor | Service |
| Bike tune-up | Outdoor | Service |
| Strava, AllTrails subscription | Outdoor | Service |
| Camera lens, body, tripod, gimbal | Photography | Gear |
| Camera bag | Photography | Gear |
| Camera batteries, memory cards, sensor swabs | Photography | Consumable |
| Lens cleaning fluid | Photography | Consumable |
| Photo editing software subscription | Photography | Service |
| Cookware, bakeware, blender, Instant Pot | Kitchen | Gear |
| Olive oil, spices, coffee beans, pasta | Kitchen | Consumable |
| Gatorade, protein shake, juice, soda, beer (home consumption) | Kitchen | Consumable (Category="Drinks") |
| Vitamins, OTC meds, generic painkillers | Health | Consumable |
| Generic toothpaste, shampoo, lip balm | Health | Consumable |
| Dish soap, laundry detergent, paper towels | Home | Consumable |
| Light bulbs, household AA batteries | Home | Consumable |
| Humidifier, vacuum, furniture, bedding | Home | Gear |
| Workout shirt, gym shorts (non-outdoor) | Fitness | Gear |
| Yoga mat, dumbbells, weights | Fitness | Gear |
| Books, audiobooks, magazines | Media | Gear |
| Course / online class | Media | Service |
| Apple Watch, AirPods, monitor, keyboard | Tech | Gear |
| Software subscription (non-outdoor, non-photo) | Tech | Service |
| Casual / dress clothing, dress shoes | Wardrobe | Gear |
| Watch (non-sport), wallet, belt | Wardrobe | Gear |
| Car parts, motor oil, car accessories | Auto | Gear/Consumable as appropriate |
| Pet supplies, garden tools, gifts | Other | Gear/Consumable |

Return ONLY the JSON. Do not narrate outside the schema.`;
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
    type: parsed.type,
    reasoning: parsed.reasoning,
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
        err instanceof Anthropic.APIConnectionError ||
        err instanceof Anthropic.APIConnectionTimeoutError ||
        (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503 || err.status === 504));
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
    type: 'Gear',
    reasoning: '(classification fallback — Haiku call failed or returned invalid output)',
  };
}

function printDistribution(rows: MasterRow[]): void {
  const bySource: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const domainTypeMatrix: Record<string, number> = {};
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    const key = `${r.domain}/${r.type}`;
    domainTypeMatrix[key] = (domainTypeMatrix[key] ?? 0) + 1;
  }
  console.log('Distribution:');
  console.log(`  By source: ${JSON.stringify(bySource)}`);
  console.log(`  By domain: ${JSON.stringify(byDomain)}`);
  console.log(`  By type:   ${JSON.stringify(byType)}`);
  console.log(`  By status: ${JSON.stringify(byStatus)}`);
  console.log(`  Domain × Type breakdown:`);
  for (const [k, v] of Object.entries(domainTypeMatrix).sort()) {
    console.log(`    ${k.padEnd(20)} ${v}`);
  }
}

function printSamples(rows: MasterRow[]): void {
  const reiRows = rows.filter((r) => r.source === 'REI');
  const amazonRows = rows.filter((r) => r.source === 'Amazon');
  console.log(`\nSample rows (eyeball Haiku's classifications):`);
  console.log('\n  -- REI sample (direct mapping) --');
  pickRandom(reiRows, 3).forEach((r) => printRow(r));

  // For Amazon, show 2 samples from each non-empty (domain × type) bucket so all
  // 11 domains get visibility instead of being lost in the bulk distribution.
  const buckets = new Map<string, MasterRow[]>();
  for (const r of amazonRows) {
    const k = `${r.domain}/${r.type}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }
  const bucketKeys = [...buckets.keys()].sort();
  for (const k of bucketKeys) {
    const items = buckets.get(k)!;
    console.log(`\n  -- Amazon ${k} (${items.length} item${items.length === 1 ? '' : 's'}) --`);
    pickRandom(items, 2).forEach((r) => printRow(r));
  }
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
    `    ${r.date} | ${r.source.padEnd(6)} | ${r.domain.padEnd(7)} | ${r.type.padEnd(10)} | "${r.itemName.slice(0, 70)}"`,
  );
  console.log(
    `      → category="${r.category}", subCategory="${r.subCategory}", brand="${r.brand}", price=$${r.price.toFixed(2)}`,
  );
  if (r.reasoning) {
    console.log(`      → reasoning: ${r.reasoning}`);
  }
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
              gridProperties: { rowCount: 1000, columnCount: 17 },
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
    'Type',
    'Reasoning',
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
      r.type,
      r.reasoning,
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
