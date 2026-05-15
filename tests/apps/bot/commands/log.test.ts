import { describe, test, expect, vi } from 'vitest';
import { extractLogDraft, type LogDraft } from '../../../../apps/bot/commands/log.js';

function makeFakeAnthropic(jsonText: string) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: jsonText }],
      })),
    },
  };
}

describe('extractLogDraft', () => {
  test('parses well-formed JSON from the model into a LogDraft', async () => {
    const anthropic = makeFakeAnthropic(JSON.stringify({
      itemName: 'Couloir Harness',
      brand: 'Black Diamond',
      price: 80,
      source: 'REI',
      date: '2026-05-14',
      category: 'Climbing',
      subCategory: 'Harness',
      color: '',
      size: 'M',
      type: 'Gear',
    }));
    const draft = await extractLogDraft(anthropic as any, 'Black Diamond Couloir harness, $80, REI', '2026-05-14');
    expect(draft).toMatchObject<Partial<LogDraft>>({
      itemName: 'Couloir Harness',
      brand: 'Black Diamond',
      price: 80,
      source: 'REI',
      category: 'Climbing',
    });
  });

  test('uses today as fallback when date is empty', async () => {
    const anthropic = makeFakeAnthropic(JSON.stringify({
      itemName: 'X', brand: '', price: 0, source: 'REI', date: '',
      category: 'Climbing', subCategory: '', color: '', size: '', type: 'Gear',
    }));
    const draft = await extractLogDraft(anthropic as any, 'X', '2026-05-14');
    expect(draft?.date).toBe('2026-05-14');
  });

  test('returns null when the model emits invalid JSON', async () => {
    const anthropic = makeFakeAnthropic('not json');
    const draft = await extractLogDraft(anthropic as any, 'whatever', '2026-05-14');
    expect(draft).toBeNull();
  });

  test('returns null when required fields are missing', async () => {
    const anthropic = makeFakeAnthropic(JSON.stringify({ itemName: 'X' }));
    const draft = await extractLogDraft(anthropic as any, 'whatever', '2026-05-14');
    expect(draft).toBeNull();
  });

  test('clamps an invalid source to Other', async () => {
    const anthropic = makeFakeAnthropic(JSON.stringify({
      itemName: 'X', brand: '', price: 1, source: 'EBay', date: '2026-05-14',
      category: 'X', subCategory: '', color: '', size: '', type: 'Gear',
    }));
    const draft = await extractLogDraft(anthropic as any, 'X', '2026-05-14');
    expect(draft?.source).toBe('Other');
  });

  test('clamps an invalid type to Gear', async () => {
    const anthropic = makeFakeAnthropic(JSON.stringify({
      itemName: 'X', brand: '', price: 1, source: 'REI', date: '2026-05-14',
      category: 'X', subCategory: '', color: '', size: '', type: 'Snack',
    }));
    const draft = await extractLogDraft(anthropic as any, 'X', '2026-05-14');
    expect(draft?.type).toBe('Gear');
  });
});
