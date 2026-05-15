import { describe, test, expect } from 'vitest';
import { buildSystemPrompt } from '../../../domains/outdoor/agent.js';

const SAMPLE_COMPACT_VIEW = `=== ACTIVE OUTDOOR INVENTORY ===
Format: ...
Total rows: 2

[a1b2c3] | 2026 | Therm-a-Rest Z Lite Sol Sleeping Pad | $49.95 [Camping Gear/Sleep System]
[d4e5f6] | 2026 | Salomon X Ultra 5 Mid GORE-TEX Hiking Boots | $190 [Hiking Gear/Footwear]`;

describe('buildSystemPrompt', () => {
  test('includes the agent persona', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toMatch(/personal outdoor companion/i);
    expect(allText).toMatch(/hiking|backpacking|mountain biking|climbing|skiing|paddling|surfing/i);
  });

  test('includes the compact inventory text verbatim', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toContain(SAMPLE_COMPACT_VIEW);
  });

  test('includes the REI preference instruction', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toMatch(/prefer REI/i);
    expect(allText).toMatch(/co-op member/i);
  });

  test('describes when to use get_product_url and update_status', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const allText = blocks.map((b) => b.text).join('\n');
    expect(allText).toContain('get_product_url');
    expect(allText).toContain('update_status');
  });

  test('marks the inventory block with cache_control: ephemeral', () => {
    const blocks = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const cached = blocks.filter((b) => b.cache_control?.type === 'ephemeral');
    expect(cached).toHaveLength(1);
    expect(cached[0]!.text).toContain(SAMPLE_COMPACT_VIEW);
  });

  test('returns blocks in a stable, deterministic order', () => {
    const a = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    const b = buildSystemPrompt({ compactViewText: SAMPLE_COMPACT_VIEW });
    expect(a).toEqual(b);
  });
});
