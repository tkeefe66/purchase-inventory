import { describe, test, expect } from 'vitest';
import { buildQuery } from '../../apps/cron/pipeline.js';

const baseOpts = {
  dryRun: false,
  reprocessSince: undefined,
  maxMessages: undefined,
  ingestAfterDate: undefined,
  spreadsheetId: 'X',
  clientId: 'X', clientSecret: 'X', refreshToken: 'X',
  anthropicKey: 'X',
  telegramBotToken: undefined, telegramChatId: undefined,
};

describe('buildQuery', () => {
  test('includes in:anywhere so Gmail searches Trash + archive too', () => {
    const q = buildQuery(baseOpts);
    expect(q).toContain('in:anywhere');
  });

  test('default (no ingestAfterDate, no reprocess) uses newer_than:30d', () => {
    const q = buildQuery(baseOpts);
    expect(q).toContain('newer_than:30d');
    expect(q).toContain('-label:inventory-processed');
  });

  test('reprocess mode bypasses the label filter', () => {
    const q = buildQuery({ ...baseOpts, reprocessSince: '2026-04-30' });
    expect(q).not.toContain('-label:inventory-processed');
    expect(q).toContain('after:2026/04/30');
    expect(q).toContain('in:anywhere');
  });

  test('ingestAfterDate replaces newer_than', () => {
    const q = buildQuery({ ...baseOpts, ingestAfterDate: '2026-04-01' });
    expect(q).toContain('after:2026/04/01');
    expect(q).not.toContain('newer_than:30d');
    expect(q).toContain('in:anywhere');
  });
});
