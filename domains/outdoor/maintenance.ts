import type { MasterRow } from '../../lib/types.js';
import { itemId } from './types.js';

/**
 * Phase 5.5 — gear age / maintenance nudges.
 *
 * Pattern-matches inventory items against a small set of category-based
 * age thresholds. Catches "boots are 4 years old, time to think about
 * resoling" or "rope is past its 5y UV-degradation retire date" cases.
 *
 * 5 rules ship in v1 (DWR shells dropped — too noisy):
 *   - 🥾 Hiking boots / shoes        : 3y check, 5y replace
 *   - ⛺ Sleeping bags                : 8y loft check, 10y replace
 *   - 🧗 Climbing rope                : 5y hard retire (UV)
 *   - ⛷️  Skis / snowboards            : 5y tune
 *   - 🪖 Helmets (all sports)         : 5y replace (foam degrades)
 *
 * Each rule produces zero or one MaintenanceFinding per item. When the
 * same item hits multiple rules, the orchestrator merges issues into a
 * single row (per the design decision).
 */

export interface MaintenanceFinding {
  itemId: string;
  itemName: string;
  brand: string;
  category: string;
  emoji: string;
  /** Years between purchase date and `today`, floored to one decimal. */
  ageYears: number;
  /** Short label for the table column, e.g. "resole due", "replace recommended". */
  issue: string;
  /** Internal stable identifier for the rule that fired (used for ack dedupe). */
  ruleId: string;
}

export interface MaintenanceRule {
  id: string;
  emoji: string;
  applies(row: MasterRow): boolean;
  /** Returns issue text + thresholdYears when the rule fires, or null. */
  evaluate(ageYears: number): { issue: string } | null;
}

function matchAny(haystack: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(haystack));
}

// All matchers check both `subCategory` AND `itemName`. Tom's sheet uses
// high-level subcategories like "Footwear", "Sleep System", "Protection",
// with the specific gear type only in itemName. Matching either lets the
// rules survive both naming styles. Patterns use left-anchored word
// boundaries with optional plural endings.

const BOOTS: MaintenanceRule = {
  id: 'boots',
  emoji: '🥾',
  applies: (r) => {
    // Ski / snowboard / wading boots don't get resoled — exclude up front.
    if (/\b(ski|snowboard|wading|telemark|nordic)\s*boot/i.test(`${r.subCategory} ${r.itemName}`)) return false;
    const haystack = `${r.subCategory} ${r.itemName}`;
    return matchAny(haystack, [
      /\bboot/i, /\bhiking shoe/i, /\bapproach shoe/i,
      /\btrail runner/i, /\btrail running shoe/i, /\bhiker\b/i,
    ]);
  },
  evaluate: (age) => {
    if (age >= 5) return { issue: 'replace recommended' };
    if (age >= 3) return { issue: 'resole due' };
    return null;
  },
};

const SLEEPING_BAG: MaintenanceRule = {
  id: 'sleeping-bag',
  emoji: '⛺',
  applies: (r) => {
    // Match the actual sleeping bag / quilt. Tom's "Sleep System" subcategory
    // also contains pads, pillows, etc. — so we require the BAG/QUILT word in
    // itemName before firing.
    const haystack = `${r.subCategory} ${r.itemName}`.toLowerCase();
    // "Sleeping pad" / "sleep pad" / "pillow" should NOT fire — exclude.
    if (/\b(pad|pillow|liner|cover)\b/i.test(r.itemName)) return false;
    return /\b(sleep(ing)? bag|quilt)\b/i.test(haystack);
  },
  evaluate: (age) => {
    if (age >= 10) return { issue: 'replacement recommended' };
    if (age >= 8) return { issue: 'loft check' };
    return null;
  },
};

const CLIMBING_ROPE: MaintenanceRule = {
  id: 'climbing-rope',
  emoji: '🧗',
  applies: (r) => {
    // Direct match — subcategory explicitly says it's a climbing rope.
    if (/\b(climbing|dynamic) rope\b/i.test(r.subCategory)) return true;
    // Fuzzy — itemName mentions rope + a climbing-ish category somewhere.
    if (/\brope/i.test(r.itemName) && /\bclimb(ing)?\b/i.test(`${r.category} ${r.subCategory}`)) return true;
    return false;
  },
  evaluate: (age) => age >= 5 ? { issue: 'retire — past 5y UV life' } : null,
};

// Ski accessory tokens (each allows a plural). Used to skip the Skis rule on
// items like "Ski Boots", "Ski Helmet", "Ski Skins".
const SKI_ACCESSORY_RE = /\b(pole|boot|skin|wax|bag|helmet|glove|goggle|sock|leash|strap|pant|jacket)s?\b/i;
const SKIS: MaintenanceRule = {
  id: 'skis',
  emoji: '⛷️',
  applies: (r) => {
    const haystack = `${r.subCategory} ${r.itemName}`;
    if (SKI_ACCESSORY_RE.test(haystack)) return false;
    return /\b(skis?|snowboard)\b/i.test(haystack);
  },
  evaluate: (age) => age >= 5 ? { issue: 'tune recommended' } : null,
};

const HELMETS: MaintenanceRule = {
  id: 'helmets',
  emoji: '🪖',
  applies: (r) => /\bhelmet/i.test(`${r.subCategory} ${r.itemName}`),
  evaluate: (age) => age >= 5 ? { issue: 'replace — foam degraded' } : null,
};

export const MAINTENANCE_RULES: readonly MaintenanceRule[] = [
  BOOTS, SLEEPING_BAG, CLIMBING_ROPE, SKIS, HELMETS,
] as const;

/**
 * Years between a YYYY-MM-DD `date` string and `today`, with one decimal of
 * precision. Returns 0 when the date is invalid, in the future, or empty —
 * the rule then never fires.
 */
export function ageYears(dateStr: string, today: Date): number {
  if (!dateStr) return 0;
  const purchased = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(purchased.getTime())) return 0;
  const ms = today.getTime() - purchased.getTime();
  if (ms <= 0) return 0;
  const years = ms / (365.25 * 24 * 60 * 60 * 1000);
  // Round, not floor — otherwise leap-year ms imprecision makes a 5y span
  // come back as 4.9. Rounding lets "almost 5y" trip a 5y threshold a few
  // days early, which is desirable behavior for safety-relevant gear.
  return Math.round(years * 10) / 10;
}

export interface EvaluateOpts {
  rows: readonly MasterRow[];
  today: Date;
}

/**
 * Run all maintenance rules against `rows`. Filters to active outdoor gear
 * internally (so callers don't have to). Returns one finding per
 * (item, rule) pair — the orchestrator merges by item if desired.
 */
export function evaluateInventory(opts: EvaluateOpts): MaintenanceFinding[] {
  const findings: MaintenanceFinding[] = [];
  for (const row of opts.rows) {
    if (row.status !== 'active') continue;
    if (row.type !== 'Gear') continue;
    if (row.domain !== 'Outdoor') continue;
    const age = ageYears(row.date, opts.today);
    if (age <= 0) continue;
    for (const rule of MAINTENANCE_RULES) {
      if (!rule.applies(row)) continue;
      const out = rule.evaluate(age);
      if (!out) continue;
      findings.push({
        itemId: itemId(row),
        itemName: row.itemName,
        brand: row.brand,
        category: row.category,
        emoji: rule.emoji,
        ageYears: age,
        issue: out.issue,
        ruleId: rule.id,
      });
    }
  }
  return findings;
}

export interface MergedFinding {
  itemId: string;
  itemName: string;
  brand: string;
  emoji: string;
  ageYears: number;
  /** Concatenated issue text when an item fired multiple rules. */
  issue: string;
  ruleIds: string[];
}

/**
 * Merge multiple findings on the same item into a single row, concatenating
 * issues with "; ". User option chosen 2026-05-17 — simpler UX over
 * per-reason ack granularity.
 */
export function mergeFindings(findings: readonly MaintenanceFinding[]): MergedFinding[] {
  const byItem = new Map<string, MergedFinding>();
  for (const f of findings) {
    const existing = byItem.get(f.itemId);
    if (existing) {
      existing.issue = `${existing.issue}; ${f.issue}`;
      existing.ruleIds.push(f.ruleId);
    } else {
      byItem.set(f.itemId, {
        itemId: f.itemId,
        itemName: f.itemName,
        brand: f.brand,
        emoji: f.emoji,
        ageYears: f.ageYears,
        issue: f.issue,
        ruleIds: [f.ruleId],
      });
    }
  }
  // Sort oldest first so the most urgent items lead.
  return Array.from(byItem.values()).sort((a, b) => b.ageYears - a.ageYears);
}
