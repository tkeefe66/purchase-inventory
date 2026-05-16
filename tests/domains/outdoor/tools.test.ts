import { describe, test, expect, vi } from 'vitest';
import { createTools, TOOL_SCHEMAS, type ToolDeps } from '../../../domains/outdoor/tools.js';
import { InventoryCache } from '../../../apps/bot/inventoryCache.js';
import { itemId } from '../../../domains/outdoor/types.js';
import type { MasterRow } from '../../../lib/types.js';
import {
  FIXTURE_THERMAREST,
  FIXTURE_SALOMON,
} from '../../fixtures/outdoor-items.js';

function makeDeps(rows: MasterRow[]): { deps: ToolDeps; cache: InventoryCache; updateCalls: { rowIndex: number; newStatus: string }[] } {
  const updateCalls: { rowIndex: number; newStatus: string }[] = [];
  const fakeSheets = {} as ToolDeps['sheets'];
  const fakeUpdate = vi.fn(async (_s: unknown, _id: string, input: { rowIndex: number; newStatus: string }) => {
    updateCalls.push(input);
  });
  const cache = new InventoryCache(async () => rows);
  return {
    cache,
    updateCalls,
    deps: {
      cache,
      sheets: fakeSheets,
      spreadsheetId: 'TEST_SHEET_ID',
      updateRowStatus: fakeUpdate as unknown as ToolDeps['updateRowStatus'],
    },
  };
}

describe('TOOL_SCHEMAS', () => {
  test('exports two tools: get_product_url and update_status', () => {
    const names = TOOL_SCHEMAS.map((s) => s.name);
    expect(names).toContain('get_product_url');
    expect(names).toContain('update_status');
    expect(TOOL_SCHEMAS).toHaveLength(3);
  });

  test('update_status schema constrains new_status to the valid enum', () => {
    const t = TOOL_SCHEMAS.find((s) => s.name === 'update_status')!;
    const statusProp = (t.input_schema.properties as Record<string, { enum?: readonly string[] }>).new_status;
    expect(statusProp?.enum).toEqual(
      expect.arrayContaining(['active', 'retired', 'returned', 'lost', 'broken', 'sold', 'donated', 'excluded']),
    );
  });

  test('exports get_forecast', () => {
    const names = TOOL_SCHEMAS.map((s) => s.name);
    expect(names).toContain('get_forecast');
  });

  test('get_forecast schema requires location and days', () => {
    const t = TOOL_SCHEMAS.find((s) => s.name === 'get_forecast')!;
    expect(t.input_schema.required).toEqual(expect.arrayContaining(['location', 'days']));
    const props = t.input_schema.properties as Record<string, { type: string; minimum?: number; maximum?: number }>;
    expect(props.location?.type).toBe('string');
    expect(props.days?.type).toBe('integer');
    expect(props.days?.minimum).toBe(1);
    expect(props.days?.maximum).toBe(7);
  });
});

describe('get_product_url handler', () => {
  test('returns the product URL for a known item id', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_product_url({ item_id: itemId(FIXTURE_THERMAREST) });
    expect(result.ok).toBe(true);
    expect(result.product_url).toBe(FIXTURE_THERMAREST.productUrl);
  });

  test('returns ok=false when the id is unknown', async () => {
    const { deps, cache } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.get_product_url({ item_id: '000000' });
    expect(result.ok).toBe(false);
    expect(result.product_url).toBeNull();
  });
});

describe('update_status handler', () => {
  test('writes the new status to the sheet and updates the cache', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST, FIXTURE_SALOMON]);
    await cache.refresh();
    const tools = createTools(deps);
    const tid = itemId(FIXTURE_THERMAREST);
    const result = await tools.update_status({ item_id: tid, new_status: 'retired' });

    expect(result.ok).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]!.rowIndex).toBe(2);
    expect(updateCalls[0]!.newStatus).toBe('retired');
    expect(cache.getCompactView().text).not.toContain('Therm-a-Rest');
  });

  test('returns ok=false for unknown item id; does not touch the sheet', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.update_status({ item_id: 'xxxxxx', new_status: 'retired' });
    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });

  test('rejects an invalid status value before touching the sheet', async () => {
    const { deps, cache, updateCalls } = makeDeps([FIXTURE_THERMAREST]);
    await cache.refresh();
    const tools = createTools(deps);
    const result = await tools.update_status({
      item_id: itemId(FIXTURE_THERMAREST),
      // @ts-expect-error — testing runtime rejection
      new_status: 'gone-fishing',
    });
    expect(result.ok).toBe(false);
    expect(updateCalls).toHaveLength(0);
  });
});
