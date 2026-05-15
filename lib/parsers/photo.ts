import type Anthropic from '@anthropic-ai/sdk';
import { VISION_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';

export type Confidence = 'high' | 'low' | 'missing';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface PhotoExtraction {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  // Optional caption-derived hints. Only filled if the user wrote them in
  // the /addgear caption; never inferred from the photo alone.
  date?: string;        // YYYY-MM-DD
  price?: number;       // post-discount USD
  confidence: {
    brand: Confidence;
    itemName: Confidence;
    color: Confidence;
    size: Confidence;
  };
}

/**
 * Derives the Anthropic vision media type from a Telegram file path like
 * "photos/file_42.jpg". Falls back to JPEG (Telegram's default for camera-roll
 * photos) when the extension is unknown.
 */
export function mediaTypeFromPath(filePath: string): ImageMediaType {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
}

const SYSTEM_PROMPT = `You extract structured product info from a photograph of a piece of outdoor gear plus an optional free-form caption the user typed. The user took the photo to log an already-owned item; there is no receipt.

Return JSON only with this exact shape:
{
  "brand": "<brand, or empty string if not visible>",
  "itemName": "<product name, brand stripped, empty string if not visible>",
  "color": "<color or empty>",
  "size": "<size from tag, e.g. 'M', '32x32', empty if not visible>",
  "date": "<YYYY-MM-DD, only if a purchase date appears in the caption, otherwise omit this field entirely>",
  "price": <number, only if a price appears in the caption, otherwise omit this field entirely>,
  "confidence": {
    "brand": "high" | "low" | "missing",
    "itemName": "high" | "low" | "missing",
    "color": "high" | "low" | "missing",
    "size": "high" | "low" | "missing"
  }
}

Rules:
- "high" = you can clearly read it on a tag, label, or print
- "low" = you can guess from style/shape but it isn't printed
- "missing" = no signal at all; the field is an empty string in that case
- Item name should NOT include the brand prefix (we store brand separately)
- The CAPTION is highly authoritative. If the caption explicitly names the brand or product, USE that — do not let an unclear tag in the photo override an explicit caption.
- The caption may include a date in many shapes: "12-11-21", "12/21/23", "May 5 2023", "Sept. 12 2019", "2018", "December 2020". Resolve to YYYY-MM-DD. US convention: M/D/Y. 2-digit years assume 2000s. Year-only → YYYY-01-01. Month+year → YYYY-MM-01.
- The caption may include a price in many shapes: "$135.15", "135.15", "for 120", "$1500". Bare 4-digit numbers in 1900–2099 with no $ are years, not prices.
- If a field is not in the caption, OMIT date / price (do not include them with empty values).
- Return JSON only, no prose, no markdown fences`;

export async function extractFromPhoto(
  anthropic: Anthropic,
  imageBytes: Buffer,
  caption: string,
  mediaType: ImageMediaType = 'image/jpeg',
): Promise<PhotoExtraction | null> {
  const base64 = imageBytes.toString('base64');
  const resp = await callWithRetry(() =>
    anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 512,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: caption || '(no caption)' },
          ],
        },
      ],
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
  // Reject responses missing the structural confidence block — without it we
  // can't tell "missing-and-confirmed" from "the model forgot to score this
  // field", and the caller's branching depends on real confidence values.
  if (typeof raw.confidence !== 'object' || raw.confidence === null) return null;
  const conf = raw.confidence as Record<string, unknown>;
  const validConf = (v: unknown): Confidence =>
    v === 'high' || v === 'low' || v === 'missing' ? v : 'missing';

  const out: PhotoExtraction = {
    brand: String(raw.brand ?? ''),
    itemName: String(raw.itemName ?? ''),
    color: String(raw.color ?? ''),
    size: String(raw.size ?? ''),
    confidence: {
      brand: validConf(conf.brand),
      itemName: validConf(conf.itemName),
      color: validConf(conf.color),
      size: validConf(conf.size),
    },
  };
  if (typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)) {
    out.date = raw.date;
  }
  if (typeof raw.price === 'number' && Number.isFinite(raw.price) && raw.price >= 0) {
    out.price = raw.price;
  }
  return out;
}
