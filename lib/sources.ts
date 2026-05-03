import type { Source } from './types.js';

export type SenderRole = 'rei-order' | 'amazon-order' | 'amazon-shipment';

export interface KnownSender {
  email: string;
  role: SenderRole;
  source: Source;
}

export const KNOWN_SENDERS: readonly KnownSender[] = [
  { email: 'rei@notices.rei.com', role: 'rei-order', source: 'REI' },
  { email: 'auto-confirm@amazon.com', role: 'amazon-order', source: 'Amazon' },
  { email: 'shipment-tracking@amazon.com', role: 'amazon-shipment', source: 'Amazon' },
];

export const PURCHASE_KEYWORDS: readonly string[] = [
  'order',
  'ordered',
  'ship',
  'shipped',
  'shipping',
  'deliver',
  'delivered',
  'delivery',
  'purchase',
  'arriving',
  'arrived',
];

const EXPECTED_SUBJECT_PATTERNS: Record<SenderRole, RegExp[]> = {
  'amazon-order': [
    /^Ordered:/i,
    /^Your Amazon\.com order/i,
    /^Order confirmation/i,
  ],
  'amazon-shipment': [
    /^Shipped:/i,
    /^Out for delivery:/i,
    /^Delivered:/i,
    /^Arriving today:/i,
    /^Arriving (tomorrow|on)/i,
  ],
  'rei-order': [
    /Your REI .*order/i,
    /has shipped/i,
    /has been (received|delivered|placed)/i,
    /order confirmation/i,
  ],
};

export function senderIsAllowlisted(from: string): boolean {
  const lc = from.toLowerCase();
  return KNOWN_SENDERS.some((s) => lc.includes(s.email));
}

export function pickSource(from: string): Source | null {
  const lc = from.toLowerCase();
  const match = KNOWN_SENDERS.find((s) => lc.includes(s.email));
  return match ? match.source : null;
}

export function pickRole(from: string): SenderRole | null {
  const lc = from.toLowerCase();
  const match = KNOWN_SENDERS.find((s) => lc.includes(s.email));
  return match ? match.role : null;
}

export function subjectMatchesExpected(role: SenderRole, subject: string): boolean {
  return EXPECTED_SUBJECT_PATTERNS[role].some((re) => re.test(subject));
}

export function subjectLooksLikePurchase(subject: string): boolean {
  const lc = subject.toLowerCase();
  return PURCHASE_KEYWORDS.some((kw) => lc.includes(kw));
}
