import { describe, test, expect } from 'vitest';
import { ageYears, evaluateInventory, mergeFindings, MAINTENANCE_RULES } from '../../../domains/outdoor/maintenance.js';
import type { MasterRow } from '../../../lib/types.js';

function row(p: Partial<MasterRow>): MasterRow {
  return {
    year: '2020', date: '2020-01-15',
    category: 'Outerwear', subCategory: 'Jacket',
    brand: 'Patagonia', itemName: 'Item',
    color: '', size: '', qty: 1, price: 100,
    source: 'REI', orderId: '',
    status: 'active', domain: 'Outdoor', productUrl: '', type: 'Gear',
    reasoning: '', notes: '',
    ...p,
  };
}

const TODAY = new Date('2026-05-17T00:00:00Z');

describe('ageYears', () => {
  test('returns years floored to 1 decimal', () => {
    expect(ageYears('2021-05-17', TODAY)).toBe(5);
    expect(ageYears('2024-05-17', TODAY)).toBe(2);
    expect(ageYears('2024-11-17', TODAY)).toBe(1.5);
  });
  test('returns 0 for empty / invalid / future dates', () => {
    expect(ageYears('', TODAY)).toBe(0);
    expect(ageYears('not-a-date', TODAY)).toBe(0);
    expect(ageYears('2030-01-01', TODAY)).toBe(0);
  });
});

describe('evaluateInventory — filtering', () => {
  test('skips non-active items', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Hiking Boot', date: '2020-01-01', status: 'retired' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(0);
  });
  test('skips non-Gear items (consumables, services)', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Hiking Boot', date: '2020-01-01', type: 'Consumable' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(0);
  });
  test('skips non-Outdoor domain', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Hiking Boot', date: '2020-01-01', domain: 'Kitchen' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('evaluateInventory — boots', () => {
  test('fires at 3y with resole-due text', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Hiking Boot', date: '2023-01-15', itemName: 'X Ultra 3', brand: 'Salomon' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.issue).toBe('resole due');
    expect(findings[0]!.emoji).toBe('🥾');
    expect(findings[0]!.ruleId).toBe('boots');
  });
  test('escalates at 5y to replace recommended', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Hiking Boot', date: '2020-01-01' })],
      today: TODAY,
    });
    expect(findings[0]!.issue).toBe('replace recommended');
  });
  test('does not fire under 3y', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Hiking Boot', date: '2024-06-01' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(0);
  });
  test('matches approach shoes, trail runners', () => {
    const findings = evaluateInventory({
      rows: [
        row({ subCategory: 'Approach Shoe', date: '2020-01-01', itemName: 'TX2' }),
        row({ subCategory: 'Trail Running Shoe', date: '2020-01-01', itemName: 'Speedgoat' }),
      ],
      today: TODAY,
    });
    expect(findings).toHaveLength(2);
  });
});

describe('evaluateInventory — sleeping bags', () => {
  test('fires at 8y with loft check', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Sleeping Bag', date: '2018-01-01', itemName: 'Megalite' })],
      today: TODAY,
    });
    expect(findings[0]!.issue).toBe('loft check');
  });
  test('escalates at 10y to replace', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Sleeping Bag', date: '2014-01-01' })],
      today: TODAY,
    });
    expect(findings[0]!.issue).toBe('replacement recommended');
  });
  test('matches quilts too', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Quilt', date: '2014-01-01' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(1);
  });
});

describe('evaluateInventory — climbing rope', () => {
  test('fires at 5y with retire text', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Climbing Rope', date: '2020-01-01', itemName: '9.4mm' })],
      today: TODAY,
    });
    expect(findings[0]!.issue).toContain('retire');
  });
  test('matches generic climbing/rope items', () => {
    const findings = evaluateInventory({
      rows: [row({ category: 'Climbing', subCategory: 'Other', date: '2020-01-01', itemName: 'Sterling Evolution Rope' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(1);
  });
});

describe('evaluateInventory — skis', () => {
  test('fires at 5y', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Skis', date: '2020-01-01', itemName: 'Salomon QST' })],
      today: TODAY,
    });
    expect(findings[0]!.issue).toBe('tune recommended');
  });
  test('does NOT fire on ski boots / poles / wax / skins (accessory false-positive guard)', () => {
    const findings = evaluateInventory({
      rows: [
        row({ subCategory: 'Ski Boots', date: '2018-01-01' }),
        row({ subCategory: 'Ski Poles', date: '2018-01-01' }),
        row({ subCategory: 'Ski Skin', date: '2018-01-01' }),
        row({ subCategory: 'Ski Wax', date: '2018-01-01' }),
      ],
      today: TODAY,
    });
    expect(findings).toHaveLength(0);
  });
});

describe('evaluateInventory — helmets', () => {
  test('matches all helmet types', () => {
    const findings = evaluateInventory({
      rows: [
        row({ subCategory: 'Bike Helmet', date: '2020-01-01' }),
        row({ subCategory: 'Climbing Helmet', date: '2020-01-01' }),
        row({ subCategory: 'Ski Helmet', date: '2020-01-01' }),
      ],
      today: TODAY,
    });
    expect(findings).toHaveLength(3);
    for (const f of findings) expect(f.issue).toContain('replace');
  });
});

describe('mergeFindings', () => {
  test('merges multiple rules on the same item, sorts by age desc', () => {
    const merged = mergeFindings([
      { itemId: 'abc', itemName: 'Boots', brand: 'X', category: 'C', emoji: '🥾', ageYears: 4, issue: 'resole due', ruleId: 'boots' },
      { itemId: 'def', itemName: 'Rope', brand: 'Y', category: 'C', emoji: '🧗', ageYears: 6, issue: 'retire', ruleId: 'climbing-rope' },
    ]);
    expect(merged).toHaveLength(2);
    // Oldest first
    expect(merged[0]!.itemId).toBe('def');
  });
  test('concatenates issues for multi-rule items', () => {
    const merged = mergeFindings([
      { itemId: 'abc', itemName: 'X', brand: 'Y', category: 'C', emoji: '🥾', ageYears: 5, issue: 'resole due', ruleId: 'boots' },
      { itemId: 'abc', itemName: 'X', brand: 'Y', category: 'C', emoji: '🥾', ageYears: 5, issue: 'something else', ruleId: 'other' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.issue).toBe('resole due; something else');
    expect(merged[0]!.ruleIds).toEqual(['boots', 'other']);
  });
});

describe('evaluateInventory — itemName matching (Tom\'s real subcategories)', () => {
  test('boots: matches "Footwear" subcategory when itemName contains Boot', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Footwear', itemName: 'Salomon X Ultra 5 Mid GORE-TEX Hiking Boots - Men\'s', date: '2020-01-01' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(1);
  });
  test('sleeping bag: matches "Sleep System" subcategory when itemName contains Sleep Bag', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Sleep System', itemName: 'Forbidden Road Portable Single Sleep Bag 15 ℃', date: '2018-01-01' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.issue).toBe('loft check');
  });
  test('sleeping bag: does NOT fire on sleeping PAD in "Sleep System" subcategory', () => {
    const findings = evaluateInventory({
      rows: [
        row({ subCategory: 'Sleep System', itemName: 'Therm-a-Rest Z Lite Sol Sleeping Pad', date: '2014-01-01' }),
        row({ subCategory: 'Sleep System', itemName: 'NEMO Fillo Pillow', date: '2014-01-01' }),
      ],
      today: TODAY,
    });
    expect(findings).toHaveLength(0);
  });
  test('helmets: matches "Protection" subcategory when itemName contains Helmet', () => {
    const findings = evaluateInventory({
      rows: [row({ subCategory: 'Protection', itemName: 'Smith Charger MIPS Snow Helmet', date: '2020-01-01' })],
      today: TODAY,
    });
    expect(findings).toHaveLength(1);
  });
});

describe('MAINTENANCE_RULES', () => {
  test('exposes exactly 5 rules (no DWR)', () => {
    expect(MAINTENANCE_RULES.map((r) => r.id).sort()).toEqual(
      ['boots', 'climbing-rope', 'helmets', 'skis', 'sleeping-bag'],
    );
  });
});
