import { describe, test, expect } from 'vitest';
import { buildExistingKeySet, dedupItems, makeDedupKey } from '../lib/dedup.js';

describe('makeDedupKey', () => {
  test('joins normalized fields', () => {
    expect(
      makeDedupKey({
        orderId: '113-1234567-1234567',
        brand: 'Salomon',
        itemName: 'X Ultra 5 Mid GORE-TEX Hiking Boots',
        color: 'Black',
        size: 'M',
      }),
    ).toBe('113-1234567-1234567||salomon||x ultra 5 mid gore-tex hiking boots||black||m');
  });

  test('strips brand prefix from itemName when it matches the brand', () => {
    // Parser-produced row: brand inline in itemName
    const parsedKey = makeDedupKey({
      orderId: 'A398',
      brand: 'Salomon',
      itemName: 'Salomon X Ultra 5 Mid GORE-TEX Hiking Boots',
      color: 'Black',
      size: 'M',
    });
    // Historical row: brand split out
    const historicalKey = makeDedupKey({
      orderId: 'A398',
      brand: 'Salomon',
      itemName: 'X Ultra 5 Mid GORE-TEX Hiking Boots',
      color: 'Black',
      size: 'M',
    });
    expect(parsedKey).toBe(historicalKey);
  });

  test('treats casing and whitespace as equivalent', () => {
    expect(
      makeDedupKey({ orderId: 'A1', brand: 'REI Co-op', itemName: 'Tent', color: 'Red', size: 'M' }),
    ).toBe(
      makeDedupKey({ orderId: 'A1', brand: 'rei co-op', itemName: 'TENT', color: '  RED  ', size: ' m ' }),
    );
  });

  test('handles blank Order ID', () => {
    expect(
      makeDedupKey({ orderId: '', brand: 'Patagonia', itemName: 'R1', color: '', size: '' }),
    ).toBe('||patagonia||r1||||');
  });
});

describe('buildExistingKeySet', () => {
  test('full key for every row; content key only when Order ID is blank', () => {
    const idx = buildExistingKeySet([
      { orderId: 'A1', brand: 'X', itemName: 'Y', color: '', size: '' },
      { orderId: '', brand: 'Z', itemName: 'W', color: '', size: '' },
    ]);
    expect(idx.fullKeys.size).toBe(2);
    expect(idx.blankOrderContentKeys.size).toBe(1);
  });
});

describe('dedupItems', () => {
  const empty = buildExistingKeySet([]);

  test('returns all items when index is empty', () => {
    const items = [
      { orderId: 'A', brand: 'X', itemName: 'Foo', color: '', size: '' },
      { orderId: 'B', brand: 'Y', itemName: 'Bar', color: '', size: '' },
    ];
    expect(dedupItems(items, empty)).toEqual(items);
  });

  test('filters out items whose exact key matches an existing key', () => {
    const items = [
      { orderId: 'A', brand: 'X', itemName: 'Foo', color: '', size: '' },
      { orderId: 'B', brand: 'Y', itemName: 'Bar', color: '', size: '' },
    ];
    const existing = buildExistingKeySet([
      { orderId: 'A', brand: 'X', itemName: 'Foo', color: '', size: '' },
    ]);
    expect(dedupItems(items, existing)).toHaveLength(1);
    expect(dedupItems(items, existing)[0]?.orderId).toBe('B');
  });

  test('wildcard cross-match: new item with Order ID dedups vs historical row without Order ID', () => {
    // Historical REI row from manual entry (no Order ID)
    const historicalRow = {
      orderId: '',
      brand: 'Salomon',
      itemName: 'X Ultra 5 Mid GORE-TEX Hiking Boots - Men\'s',
      color: 'Black/Asphalt',
      size: '9',
    };
    const existing = buildExistingKeySet([historicalRow]);

    // New item from email parser (Order ID populated, brand inline in name)
    const newItem = {
      orderId: 'A398129839',
      brand: 'Salomon',
      itemName: "Salomon X Ultra 5 Mid GORE-TEX Hiking Boots - Men's",
      color: 'Black/Asphalt',
      size: '9',
    };
    expect(dedupItems([newItem], existing)).toHaveLength(0);
  });

  test('does NOT cross-match different items just because one has blank Order ID', () => {
    const historicalRow = {
      orderId: '',
      brand: 'Salomon',
      itemName: 'X Ultra 5 Mid GORE-TEX Hiking Boots',
      color: 'Black',
      size: '9',
    };
    const existing = buildExistingKeySet([historicalRow]);

    const differentItem = {
      orderId: 'A1',
      brand: 'Salomon',
      itemName: 'Quest 4 Boots',  // different item
      color: 'Black',
      size: '9',
    };
    expect(dedupItems([differentItem], existing)).toHaveLength(1);
  });

  test('same brand, same name, different color → not a dup', () => {
    const existing = buildExistingKeySet([
      { orderId: 'A1', brand: 'Patagonia', itemName: 'R1 Hoody', color: 'Black', size: 'M' },
    ]);
    const newItem = { orderId: 'A2', brand: 'Patagonia', itemName: 'R1 Hoody', color: 'Blue', size: 'M' };
    expect(dedupItems([newItem], existing)).toHaveLength(1);
  });

  test('legitimate re-buy: same item, two different Order IDs both land in sheet', () => {
    // First purchase already in sheet
    const existing = buildExistingKeySet([
      { orderId: 'A1', brand: 'Patagonia', itemName: 'R1 Hoody', color: 'Black', size: 'M' },
    ]);
    // Re-buying the same item later under a different Order ID
    const newItem = { orderId: 'A2', brand: 'Patagonia', itemName: 'R1 Hoody', color: 'Black', size: 'M' };
    // Both should appear; new item is NOT a duplicate.
    expect(dedupItems([newItem], existing)).toHaveLength(1);
  });

  test('filters duplicates within the same batch', () => {
    const items = [
      { orderId: 'A', brand: 'X', itemName: 'Foo', color: '', size: '' },
      { orderId: 'A', brand: 'X', itemName: 'Foo', color: '', size: '' }, // dup
    ];
    expect(dedupItems(items, empty)).toHaveLength(1);
  });

  test('strong key dedup: same orderId + same ASIN catches item-name drift', () => {
    // Auto-confirm parsed by Haiku gives a short, clean name.
    const autoConfirm = {
      orderId: '113-8780872-2847422',
      brand: 'Peak Design',
      itemName: 'Capture Camera Clip V3',
      color: '',
      size: '',
      productUrl: 'https://www.amazon.com/dp/B0CHX1W1XY',
    };
    const idx = buildExistingKeySet([autoConfirm]);

    // Same item later arrives via shipment-tracking — IMG alt is much longer,
    // brand is duplicated, color/extras inline. Normalized names DON'T match.
    const shipment = {
      orderId: '113-8780872-2847422',
      brand: 'Peak Design',
      itemName: 'Peak Design Peak Design Capture Camera Clip V3, Black with Plate, Holds DSLR, Compact and Point and Shoot Bodies',
      color: 'Black',
      size: '',
      productUrl: 'https://www.amazon.com/Peak-Design-Capture-Camera-Clip/dp/B0CHX1W1XY?ref=ppx',
    };
    expect(dedupItems([shipment], idx)).toHaveLength(0);
  });

  test('strong key does NOT collapse different items in the same order', () => {
    const idx = buildExistingKeySet([{
      orderId: '113-1111111-1111111',
      brand: 'Peak Design',
      itemName: 'Capture Camera Clip V3',
      color: '',
      size: '',
      productUrl: 'https://www.amazon.com/dp/B0CHX1W1XY',
    }]);
    // Same order, different product → different ASIN → not a dup.
    const otherItem = {
      orderId: '113-1111111-1111111',
      brand: 'Sigma',
      itemName: '18-50mm F2.8 DC DN Contemporary',
      color: '',
      size: '',
      productUrl: 'https://www.amazon.com/dp/B09ZZZZZZZ',
    };
    expect(dedupItems([otherItem], idx)).toHaveLength(1);
  });

  test('strong key dedup within a single batch (defensive)', () => {
    // Same order/ASIN appearing twice in one batch (e.g. retry / duplicate
    // shipment notification) should collapse to one row.
    const items = [
      {
        orderId: 'A1', brand: 'X', itemName: 'Foo', color: '', size: '',
        productUrl: 'https://amazon.com/dp/B0AAAAAAAA',
      },
      {
        orderId: 'A1', brand: 'X', itemName: 'Foo (different name)', color: '', size: '',
        productUrl: 'https://amazon.com/dp/B0AAAAAAAA',
      },
    ];
    expect(dedupItems(items, empty)).toHaveLength(1);
  });

  test('cross-match TOLERATES color/size formatting differences (the Salomon case)', () => {
    // Historical row: REI's 3-component colorway, manually entered
    const historical = {
      orderId: '',
      brand: 'Salomon',
      itemName: "X Ultra 5 Mid GORE-TEX Hiking Boots - Men's",
      color: 'Black/Asphalt/Castlerock',
      size: '9',
    };
    const idx = buildExistingKeySet([historical]);

    // Fresh email row: shorter colorway from order email, brand inline in name
    const fresh = {
      orderId: 'A398129839',
      brand: 'Salomon',
      itemName: "Salomon X Ultra 5 Mid GORE-TEX Hiking Boots - Men's",
      color: 'Black/Asphalt',
      size: '9',
    };
    expect(dedupItems([fresh], idx)).toHaveLength(0);
  });
});
