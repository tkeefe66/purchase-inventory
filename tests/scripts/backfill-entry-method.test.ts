import { describe, it, expect } from 'vitest';
import { inferEntryMethod } from '../../scripts/backfill-entry-method.js';

describe('inferEntryMethod', () => {
  it('recognizes photo-upload orderIds', () => {
    expect(inferEntryMethod('IMG-20260514-abc123')).toBe('photo');
    expect(inferEntryMethod('IMG-20240101-9f8e7d6c')).toBe('photo');
  });

  it('recognizes REI online order IDs', () => {
    expect(inferEntryMethod('A12345678')).toBe('email');
    expect(inferEntryMethod('A1234567890')).toBe('email');
  });

  it('recognizes REI in-store eReceipt IDs', () => {
    expect(inferEntryMethod('S123-T456789')).toBe('email');
  });

  it('recognizes Amazon order IDs', () => {
    expect(inferEntryMethod('113-8158227-8962610')).toBe('email');
    expect(inferEntryMethod('111-2222222-3333333')).toBe('email');
  });

  it('falls back to import for unrecognized patterns', () => {
    expect(inferEntryMethod('')).toBe('import');
    expect(inferEntryMethod('foo')).toBe('import');
    expect(inferEntryMethod('manual-2020-thing')).toBe('import');
  });

  it('does not match IMG prefix on its own (needs the date+hash suffix)', () => {
    expect(inferEntryMethod('IMG-')).toBe('import');
    expect(inferEntryMethod('IMG-2026')).toBe('import');
  });
});
