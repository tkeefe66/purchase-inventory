import type Anthropic from '@anthropic-ai/sdk';
import { PARSER_MODEL } from '../../../lib/models.js';
import { callWithRetry } from '../../../lib/anthropic-retry.js';
import type { ItemType, Source } from '../../../lib/types.js';

export interface LogDraft {
  itemName: string;
  brand: string;
  price: number;
  source: Source;
  date: string;
  category: string;
  subCategory: string;
  color: string;
  size: string;
  type: ItemType;
}

const KNOWN_SOURCES: readonly Source[] = ['REI', 'Amazon', 'Other'];
const KNOWN_TYPES: readonly ItemType[] = ['Gear', 'Consumable', 'Service'];

const SYSTEM_PROMPT = `You extract structured purchase fields from Tom's free-form /log text. He uses this for in-store / cash / marketplace purchases that didn't come through Gmail.

Return JSON only, with these exact fields:
{
  "itemName": "<cleaned product name, brand stripped>",
  "brand": "<brand>",
  "price": <number, post-discount, USD>,
  "source": "REI" | "Amazon" | "Other",
  "date": "<YYYY-MM-DD, or empty string to default to today>",
  "category": "<outdoor category, e.g. Climbing>",
  "subCategory": "<finer category, e.g. Harness>",
  "color": "<or empty>",
  "size": "<or empty>",
  "type": "Gear" | "Consumable" | "Service"
}

Rules:
- If the user says "today" or omits a date → return "" for date and the caller will default to today.
- Source: if the user mentions REI or Amazon, use those. Otherwise "Other".
- Always assume Outdoor domain (Tom only uses /log for outdoor purchases).
- Be conservative on category/subCategory; use empty strings if you're not confident.
- Return JSON only, no prose.`;

export async function extractLogDraft(
  anthropic: Anthropic,
  userText: string,
  todayIso: string,
): Promise<LogDraft | null> {
  const resp = await callWithRetry(() =>
    anthropic.messages.create({
      model: PARSER_MODEL,
      max_tokens: 512,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }],
    }),
  );
  const block = resp.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  if (!block) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(block.text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const requiredKeys = ['itemName', 'brand', 'price', 'source', 'date', 'category', 'subCategory', 'color', 'size', 'type'];
  if (!requiredKeys.every((k) => k in raw)) return null;
  const source = KNOWN_SOURCES.includes(raw.source as Source) ? (raw.source as Source) : 'Other';
  const type = KNOWN_TYPES.includes(raw.type as ItemType) ? (raw.type as ItemType) : 'Gear';
  const date = typeof raw.date === 'string' && raw.date.length > 0 ? raw.date : todayIso;
  return {
    itemName: String(raw.itemName ?? ''),
    brand: String(raw.brand ?? ''),
    price: Number(raw.price ?? 0),
    source,
    date,
    category: String(raw.category ?? ''),
    subCategory: String(raw.subCategory ?? ''),
    color: String(raw.color ?? ''),
    size: String(raw.size ?? ''),
    type,
  };
}
