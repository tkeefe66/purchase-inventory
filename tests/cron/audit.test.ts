import { describe, test, expect, vi } from 'vitest';
import { runAudit, type AuditResult } from '../../apps/cron/audit.js';
import type { GmailClient } from '../../lib/gmail.js';
import type { gmail_v1 } from 'googleapis';

function fakeGmailMessage(id: string, from: string, subject: string): gmail_v1.Schema$Message {
  return {
    id,
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        { name: 'Date', value: new Date().toUTCString() },
      ],
    },
  };
}

function makeFakeGmail(messages: gmail_v1.Schema$Message[]): GmailClient {
  return {
    users: {
      messages: {
        list: vi.fn().mockResolvedValue({
          data: { messages: messages.map((m) => ({ id: m.id })) },
        }),
        get: vi.fn().mockImplementation(({ id }: { id: string }) => {
          const m = messages.find((mm) => mm.id === id);
          return Promise.resolve({ data: m });
        }),
      },
    },
  } as unknown as GmailClient;
}

describe('runAudit', () => {
  test('returns clean result when no suspicious emails', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('a', 'auto-confirm@amazon.com', 'Ordered: "Foo"'),
      fakeGmailMessage('b', 'shipment-tracking@amazon.com', 'Shipped: "Foo"'),
      fakeGmailMessage('c', 'rei@notices.rei.com', 'Your REI order #123 has shipped'),
    ]);
    const result: AuditResult = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.senderDrift).toEqual([]);
    expect(result.subjectDrift).toEqual([]);
    expect(result.clean).toBe(true);
  });

  test('flags purchase-shaped subjects from non-allowlisted senders (Check A)', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('a', 'auto-confirm@amazon.com', 'Ordered: "Foo"'),
      fakeGmailMessage('x', 'orders-confirm@amazon.com', 'Ordered: "Bar"'),
    ]);
    const result = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.senderDrift).toHaveLength(1);
    expect(result.senderDrift[0]).toMatchObject({
      from: 'orders-confirm@amazon.com',
      subject: 'Ordered: "Bar"',
    });
    expect(result.subjectDrift).toEqual([]);
    expect(result.clean).toBe(false);
  });

  test('flags purchase-keyword subjects from allowlisted senders that do not match expected patterns (Check B)', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('a', 'auto-confirm@amazon.com', 'Ordered: "Foo"'),
      fakeGmailMessage('y', 'auto-confirm@amazon.com', 'Pre-ordered today: "Bar"'),
    ]);
    const result = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.subjectDrift).toHaveLength(1);
    expect(result.subjectDrift[0]).toMatchObject({
      from: 'auto-confirm@amazon.com',
      subject: 'Pre-ordered today: "Bar"',
    });
    expect(result.senderDrift).toEqual([]);
    expect(result.clean).toBe(false);
  });

  test('does not flag non-purchase subjects from allowlisted senders (Check B noise reduction)', async () => {
    const gmail = makeFakeGmail([
      fakeGmailMessage('z', 'auto-confirm@amazon.com', 'Update your account preferences'),
    ]);
    const result = await runAudit({ gmail, lookbackDays: 8 });
    expect(result.subjectDrift).toEqual([]);
    expect(result.clean).toBe(true);
  });

  test('caps the number of flagged samples returned per check (max 10)', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      fakeGmailMessage(`m${i}`, 'orders-confirm@amazon.com', `Ordered: "Item ${i}"`),
    );
    const result = await runAudit({ gmail: makeFakeGmail(many), lookbackDays: 8 });
    expect(result.senderDrift.length).toBeLessThanOrEqual(10);
    expect(result.totals.senderDrift).toBe(25);
  });
});
