import type Anthropic from '@anthropic-ai/sdk';
import { VISION_MODEL } from '../models.js';
import { callWithRetry } from '../anthropic-retry.js';

export type Confidence = 'high' | 'low' | 'missing';

export interface PhotoExtraction {
  brand: string;
  itemName: string;
  color: string;
  size: string;
  confidence: {
    brand: Confidence;
    itemName: Confidence;
    color: Confidence;
    size: Confidence;
  };
}

const SYSTEM_PROMPT = `You extract structured product info from a photograph of a piece of outdoor gear. The user has taken the photo to log an already-owned item into a personal inventory. There is no receipt — you are reading hang tags, labels, embroidered logos, and the gear itself.

Return JSON only with this exact shape:
{
  "brand": "<brand, or empty string if not visible>",
  "itemName": "<product name, brand stripped, empty string if not visible>",
  "color": "<color or empty>",
  "size": "<size from tag, e.g. 'M', '32x32', empty if not visible>",
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
- If the user caption (passed as text below the image) names the gear, weight it but still verify against the photo
- Return JSON only, no prose, no markdown fences`;

export async function extractFromPhoto(
  anthropic: Anthropic,
  imageBytes: Buffer,
  caption: string,
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
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
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
  const conf = (raw.confidence ?? {}) as Record<string, unknown>;
  const validConf = (v: unknown): Confidence =>
    v === 'high' || v === 'low' || v === 'missing' ? v : 'missing';
  return {
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
}
