import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseReiEmail } from '../../lib/parsers/rei.js';

const FIXTURES = resolve(import.meta.dirname, '../fixtures/rei');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('parseReiEmail', () => {
  test('extracts order ID from a single-item order confirmation', () => {
    const html = loadFixture(
      "19dd9b2a7d11aca2__Thanks_for_your_order!_(A398129839).html",
    );
    const result = parseReiEmail(html);
    expect(result).not.toBeNull();
    expect(result?.orderId).toBe('A398129839');
    expect(result?.source).toBe('REI');
  });

  test('extracts a single line item with name, price, quantity, productUrl', () => {
    const html = loadFixture(
      "19dd9b2a7d11aca2__Thanks_for_your_order!_(A398129839).html",
    );
    const result = parseReiEmail(html);
    expect(result?.items).toHaveLength(1);
    const item = result!.items[0]!;
    expect(item.itemName).toBe("Salomon X Ultra 5 Mid GORE-TEX Hiking Boots - Men's");
    expect(item.price).toBe(190.0);
    expect(item.quantity).toBe(1);
    expect(item.productUrl).toMatch(/^https?:\/\//);
  });

  test('returns null for a delivery notification (no items to ingest)', () => {
    const html = loadFixture('19de52cf28d8e9bf__Your_order_was_delivered!.html');
    expect(parseReiEmail(html)).toBeNull();
  });

  test('extracts color and size when present (apparel/footwear)', () => {
    const html = loadFixture(
      "19dd9b2a7d11aca2__Thanks_for_your_order!_(A398129839).html",
    );
    const item = parseReiEmail(html)!.items[0]!;
    expect(item.color).toBe('Black/Asphalt');
    expect(item.size).toBe('9');
  });

  test('returns null for a shipping notification (status update, not a receipt)', () => {
    const html = loadFixture('19ddc050a69908b9__Your_order_shipped_ahead_of_schedule.html');
    expect(parseReiEmail(html)).toBeNull();
  });

  test('parses a different single-item order (REI tent — color but no size)', () => {
    const html = loadFixture(
      "19dcb4ac39743b0f__Thanks_for_your_order!_(A398102602).html",
    );
    const result = parseReiEmail(html);
    expect(result?.orderId).toBe('A398102602');
    expect(result?.items).toHaveLength(1);
    const item = result!.items[0]!;
    expect(item.itemName).toBe('REI Co-op Base Camp 4 Tent');
    expect(item.price).toBe(489.0);
    expect(item.quantity).toBe(1);
    expect(item.color).toBe('Desert Moss');
    expect(item.size).toBe('');
  });
});
