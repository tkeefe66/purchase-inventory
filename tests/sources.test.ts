import { describe, test, expect } from 'vitest';
import {
  senderIsAllowlisted,
  pickSource,
  subjectMatchesExpected,
  subjectLooksLikePurchase,
  KNOWN_SENDERS,
  PURCHASE_KEYWORDS,
} from '../lib/sources.js';

describe('senderIsAllowlisted', () => {
  test('matches REI order sender', () => {
    expect(senderIsAllowlisted('REI <rei@notices.rei.com>')).toBe(true);
  });
  test('matches Amazon order sender', () => {
    expect(senderIsAllowlisted('"Amazon.com" <auto-confirm@amazon.com>')).toBe(true);
  });
  test('matches Amazon shipment sender', () => {
    expect(senderIsAllowlisted('Amazon Shipping <shipment-tracking@amazon.com>')).toBe(true);
  });
  test('rejects amazon promo sender', () => {
    expect(senderIsAllowlisted('Amazon <store-news@amazon.com>')).toBe(false);
  });
  test('rejects unrelated sender', () => {
    expect(senderIsAllowlisted('hello@example.com')).toBe(false);
  });
  test('is case-insensitive', () => {
    expect(senderIsAllowlisted('REI@NOTICES.REI.COM')).toBe(true);
  });
});

describe('pickSource', () => {
  test('returns REI for the REI notices sender', () => {
    expect(pickSource('rei@notices.rei.com')).toBe('REI');
  });
  test('returns Amazon for both auto-confirm and shipment-tracking', () => {
    expect(pickSource('auto-confirm@amazon.com')).toBe('Amazon');
    expect(pickSource('shipment-tracking@amazon.com')).toBe('Amazon');
  });
  test('returns null for non-allowlisted senders', () => {
    expect(pickSource('store-news@amazon.com')).toBeNull();
  });
});

describe('subjectMatchesExpected', () => {
  test('matches Amazon "Ordered:" pattern for amazon-order role', () => {
    expect(subjectMatchesExpected('amazon-order', 'Ordered: "USA Gear Camera Sleeve..."')).toBe(true);
  });
  test('matches Amazon "Shipped:" pattern for amazon-shipment role', () => {
    expect(subjectMatchesExpected('amazon-shipment', 'Shipped: "USA Gear Camera Sleeve..."')).toBe(true);
  });
  test('matches Amazon "Out for delivery:" pattern for amazon-shipment', () => {
    expect(subjectMatchesExpected('amazon-shipment', 'Out for delivery: "Foo"')).toBe(true);
  });
  test('matches REI order pattern', () => {
    expect(subjectMatchesExpected('rei-order', 'Your REI order #1234567 has been received')).toBe(true);
  });
  test('matches REI shipment pattern', () => {
    expect(subjectMatchesExpected('rei-order', 'Your REI order #1234567 has shipped')).toBe(true);
  });
  test('returns false for unrelated subject from allowlisted sender', () => {
    expect(subjectMatchesExpected('amazon-order', 'Action required: update your payment method')).toBe(false);
  });
});

describe('subjectLooksLikePurchase', () => {
  test('flags subjects containing purchase keywords', () => {
    expect(subjectLooksLikePurchase('Your order is on the way')).toBe(true);
    expect(subjectLooksLikePurchase('Shipping update for your purchase')).toBe(true);
    expect(subjectLooksLikePurchase('Delivered today')).toBe(true);
  });
  test('rejects subjects without purchase keywords', () => {
    expect(subjectLooksLikePurchase('Weekend deals just for you')).toBe(false);
    expect(subjectLooksLikePurchase('Update your account preferences')).toBe(false);
  });
});

describe('KNOWN_SENDERS / PURCHASE_KEYWORDS', () => {
  test('exports a non-empty allowlist', () => {
    expect(KNOWN_SENDERS.length).toBeGreaterThan(0);
  });
  test('exports a non-empty keyword list', () => {
    expect(PURCHASE_KEYWORDS.length).toBeGreaterThan(0);
  });
});
