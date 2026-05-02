import Anthropic from '@anthropic-ai/sdk';
import type { Domain, ItemType, Source, Vocab } from './types.js';

const HAIKU_MODEL = 'claude-haiku-4-5';
const MAX_RETRIES = 5;

export interface ClassifyInput {
  itemName: string;
  source: Source;
  retailerCategory?: string | undefined;
}

export interface Classification {
  domain: Domain;
  type: ItemType;
  category: string;
  subCategory: string;
  brand: string;
  reasoning: string;
}

export interface ClassifierOptions {
  vocab: Vocab;
  anthropic: Anthropic;
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      enum: [
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
      ],
    },
    type: { type: 'string', enum: ['Gear', 'Consumable', 'Service'] },
    category: { type: 'string' },
    subCategory: { type: 'string' },
    brand: { type: 'string' },
    reasoning: { type: 'string' },
  },
  required: ['domain', 'type', 'category', 'subCategory', 'brand', 'reasoning'],
  additionalProperties: false,
};

/**
 * Builds a classifier function with a pre-rendered system prompt baked in.
 * Use it like:
 *
 *   const classify = createClassifier({ vocab, anthropic });
 *   const c = await classify({ itemName: "...", source: "Amazon" });
 */
export function createClassifier(opts: ClassifierOptions): (input: ClassifyInput) => Promise<Classification> {
  const systemPrompt = buildSystemPrompt(opts.vocab);

  return async function classify(input: ClassifyInput): Promise<Classification> {
    const userMessage = formatUserMessage(input);

    const resp = await callWithRetry(() =>
      opts.anthropic.messages.create({
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

    const textBlock = resp.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    if (!textBlock) {
      throw new Error(`Classifier returned no text block for "${input.itemName}"`);
    }
    let parsed: Classification;
    try {
      parsed = JSON.parse(textBlock.text) as Classification;
    } catch {
      throw new Error(`Classifier returned invalid JSON for "${input.itemName}": ${textBlock.text.slice(0, 200)}`);
    }
    return parsed;
  };
}

function formatUserMessage(input: ClassifyInput): string {
  const lines = [
    'Classify this purchased item:',
    `- Item name: "${input.itemName}"`,
    `- Source retailer: ${input.source}`,
  ];
  if (input.retailerCategory) {
    lines.push(`- Retailer's own category: "${input.retailerCategory}"`);
  }
  lines.push('', 'Return the six fields per the schema.');
  return lines.join('\n');
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
        (err instanceof Anthropic.APIError &&
          (err.status === 529 || err.status === 503 || err.status === 504));
      if (!isRetryable || attempt === MAX_RETRIES - 1) throw err;
      const delayMs = Math.min(1000 * 2 ** attempt, 30000) + Math.floor(Math.random() * 500);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export function buildSystemPrompt(vocab: Vocab): string {
  const categoriesBlock = vocab.categories
    .map((c) => {
      const subs = vocab.subCategoriesByCategory[c] ?? [];
      return `  - "${c}"${subs.length > 0 ? ` → sub-categories: ${subs.map((s) => `"${s}"`).join(', ')}` : ''}`;
    })
    .join('\n');
  const brandsBlock = vocab.brands.map((b) => `  - "${b}"`).join('\n');
  return `You are a categorization assistant for a personal purchase-inventory system. Tom is building a multi-domain platform where each domain (outdoor, photography, kitchen, etc.) eventually has its own AI mentor agent. Each agent uses Tom's purchase inventory as grounding to give advice on gear, trip planning, recipes, repurchases, etc.

The categorization assigns six fields per line item:

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

Prefer the existing vocabulary below. Only invent a new category if nothing fits. For non-outdoor items, invent appropriate categories (Title Case, descriptive). Examples of new categories: "Drinks", "Vitamins & Supplements", "Cleaning Supplies", "Books & Reading", "Cookware", "Camera Accessories", "Personal Care".

### 4. **subCategory**

Finer grain. Use a known sub-category when applicable. Leave as \`""\` if no sub-category applies.

### 5. **brand**

Extract from item name when clearly identifiable (e.g. "Patagonia R1 Hoody" → "Patagonia"). Return \`""\` if no brand is recognizable. Prefer the brand list below when matching.

### 6. **reasoning**

ONE short sentence (≤25 words) explaining domain + type. Examples:
- *"Outdoor-trip food consumed during activities; outdoor agent tracks for trip prep."*
- *"Kitchen pantry staple consumed at home."*
- *"Camera memory card — consumable for photo gear; photo agent tracks."*
- *"Generic vitamin supplement, no specific domain."*

---

## Existing category taxonomy (from prior purchases — use these when they fit)

${categoriesBlock || '  (none)'}

## Existing brand list (from prior purchases)

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
