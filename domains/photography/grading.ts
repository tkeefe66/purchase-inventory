/**
 * Vision-based grading of a photo submission against an active assignment\'s
 * rubric. Single Opus 4.7 call with vision input — NOT a continuation of
 * Tom\'s chat conversation. This gives us prompt control + caching, and
 * keeps assignment grading reproducible regardless of conversation state.
 *
 * Verdict rules (mirrored from the assignment-design spec):
 *   - All criteria pass OR (n-1 of n pass and the failing one is NOT core)
 *     → verdict: pass
 *   - Two or more criteria fail OR any criterion marked is_core: true fails
 *     → verdict: did_not_pass
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELS } from '../../lib/models.js';
import { callWithRetry } from '../../lib/anthropic-retry.js';
import {
  formatAperture,
  formatShutter,
  formatFocalLength,
  type PhotoExif,
} from './exif.js';
import type { RubricCriterion } from './expander.js';

export type GradingVerdict = 'pass' | 'did_not_pass';
export type PerCriterionResult = 'pass' | 'partial' | 'fail';

export interface PerCriterion {
  criterion: string;
  result: PerCriterionResult;
  reason: string;
}

export interface GradingResult {
  verdict: GradingVerdict;
  perCriterion: PerCriterion[];
  overallCritique: string;
  suggestedNextStep: string;
}

export interface GradingInput {
  assignmentText: string;
  rubric: RubricCriterion[];
  /** EXIF or user-stated. */
  camera: string;
  lens: string;
  exif: PhotoExif | null;
  /** Caller-provided when EXIF is missing (e.g. compressed Photo). */
  manualSettings?: string;
  /** Tom's caption / context at submission, if any. */
  userNotes: string;
  /** JPEG / image bytes. */
  imageBytes: Uint8Array | Buffer;
  /** Telegram-reported MIME, used for image_media_type. */
  imageMimeType: string;
}

export interface GradingDeps {
  anthropic: Anthropic;
  /** Optional model override, useful for tests / cost tuning. Default Opus 4.7. */
  model?: string;
}

const DEFAULT_MODEL = MODELS.opus;
const MAX_TOKENS = 1500;
const SUPPORTED_VISION_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// ─── System prompt (cached) ────────────────────────────────────────────────

const GRADING_SYSTEM = `You are grading a photo submission against an assignment rubric. Be honest, direct, and specific. Cite what you actually see in the image — exposure, composition, focus, subject, light. Do not soften feedback. Tom wants to learn; flattery doesn\'t help him.

Verdict rules (apply MECHANICALLY — don\'t freelance):
  - All criteria pass → verdict: "pass".
  - n-1 of n criteria pass, the failing one is NOT marked core → verdict: "pass".
  - Two or more criteria fail → verdict: "did_not_pass".
  - Any criterion marked \`is_core: true\` fails → verdict: "did_not_pass".

Per-criterion results: use "pass" (clearly meets), "partial" (close but lacking), or "fail" (clearly does not meet). "Partial" counts as a fail for verdict purposes — partial is feedback, not credit.

Be specific in reasons — cite the actual frame ("the foreground rock is sharp but the mountain is blurred; depth of field too shallow"). Generic feedback ("good composition") is forbidden.

If technical settings hurt the result (wrong aperture for the intent, motion blur from too-slow shutter, blown highlights), call it out under suggested_next_step. If the photo is clearly from the wrong gear (e.g., iPhone instead of the assigned camera), still grade fairly against the rubric but flag the gear mismatch in suggested_next_step.

Output JSON only, matching this schema EXACTLY — output the JSON inside a \`\`\`json fenced block, no prose outside the fence:

\`\`\`json
{
  "verdict": "pass" | "did_not_pass",
  "per_criterion": [
    {"criterion": "<verbatim from rubric>", "result": "pass" | "partial" | "fail", "reason": "<specific, 1-2 sentences>"}
  ],
  "overall_critique": "<2-4 sentences of honest critique citing what you see>",
  "suggested_next_step": "<one concrete improvement Tom can apply next attempt>"
}
\`\`\``;

// ─── Public API ───────────────────────────────────────────────────────────

export async function gradePhoto(
  deps: GradingDeps,
  input: GradingInput,
): Promise<GradingResult> {
  if (!SUPPORTED_VISION_MIME.has(input.imageMimeType.toLowerCase())) {
    throw new Error(`Unsupported image MIME for vision input: ${input.imageMimeType}. Send JPEG, PNG, WebP, or GIF.`);
  }

  const userPrompt = buildUserPrompt(input);
  const imageBase64 = Buffer.from(input.imageBytes).toString('base64');

  const resp = await callWithRetry(() =>
    deps.anthropic.messages.create({
      model: deps.model ?? DEFAULT_MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text', text: GRADING_SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: userPrompt },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.imageMimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: imageBase64,
              },
            },
          ],
        },
      ] as unknown as Anthropic.Messages.MessageParam[],
    }),
  );

  const textBlocks = resp.content.filter(
    (b): b is Anthropic.Messages.TextBlock => b.type === 'text',
  );
  const text = textBlocks.map((b) => b.text).join('\n').trim();
  if (!text) {
    throw new Error(`Grading returned empty text (stop_reason=${resp.stop_reason})`);
  }
  return parseGradingResponse(text);
}

// ─── Pure prompt construction (testable) ──────────────────────────────────

export function buildUserPrompt(input: GradingInput): string {
  const lines: string[] = [];
  lines.push('## Assignment');
  lines.push(input.assignmentText);
  lines.push('');

  lines.push('## Rubric');
  input.rubric.forEach((r, i) => {
    const core = r.is_core ? ' (CORE)' : '';
    lines.push(`${i + 1}. ${r.criterion}${core}`);
    if (r.description) lines.push(`   ${r.description}`);
  });
  lines.push('');

  lines.push('## Gear Tom used');
  lines.push(`Camera: ${input.camera || '(unknown — EXIF missing)'}`);
  lines.push(`Lens: ${input.lens || '(unknown — EXIF missing)'}`);
  if (input.exif) {
    const e = input.exif;
    const settings = [
      `aperture ${formatAperture(e.aperture)}`,
      `shutter ${formatShutter(e.shutterSeconds)}`,
      e.iso !== null ? `ISO ${e.iso}` : null,
      `focal length ${formatFocalLength(e.focalLengthMm, e.focalLength35mmEq)}`,
    ].filter(Boolean).join(', ');
    lines.push(`Settings: ${settings}`);
    if (e.gpsLat !== null && e.gpsLng !== null) {
      lines.push(`GPS: ${e.gpsLat.toFixed(4)}, ${e.gpsLng.toFixed(4)}`);
    }
    if (e.dateTimeOriginal) lines.push(`Taken: ${e.dateTimeOriginal}`);
  } else if (input.manualSettings) {
    lines.push(`Settings: ${input.manualSettings} (user-stated; EXIF was stripped)`);
  } else {
    lines.push('Settings: (unknown — EXIF was stripped and user provided no manual settings)');
  }
  lines.push('');

  if (input.userNotes.trim()) {
    lines.push("## Tom's caption");
    lines.push(input.userNotes.trim());
    lines.push('');
  }

  lines.push('## The photo');
  lines.push('[attached]');
  lines.push('');
  lines.push('Grade this photo. Be specific — cite what you see in the frame.');
  return lines.join('\n');
}

// ─── Pure response parsing (testable) ─────────────────────────────────────

const JSON_FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n?```/i;

export function parseGradingResponse(text: string): GradingResult {
  const fence = text.match(JSON_FENCE_RE);
  const jsonText = (fence ? fence[1]! : text).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Grading returned non-JSON: ${(err as Error).message}. First 200 chars: ${jsonText.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Grading JSON is not an object.');
  }
  const obj = parsed as Record<string, unknown>;

  const verdict = obj.verdict;
  if (verdict !== 'pass' && verdict !== 'did_not_pass') {
    throw new Error(`Grading verdict must be "pass" or "did_not_pass", got ${JSON.stringify(verdict)}`);
  }

  if (!Array.isArray(obj.per_criterion) || obj.per_criterion.length === 0) {
    throw new Error('Grading per_criterion must be a non-empty array.');
  }
  const perCriterion: PerCriterion[] = [];
  for (const raw of obj.per_criterion) {
    if (typeof raw !== 'object' || raw === null) {
      throw new Error('Each per_criterion entry must be an object.');
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.criterion !== 'string' || !r.criterion.trim()) {
      throw new Error('Each per_criterion entry needs a criterion string.');
    }
    if (r.result !== 'pass' && r.result !== 'partial' && r.result !== 'fail') {
      throw new Error(`per_criterion result must be pass | partial | fail, got ${JSON.stringify(r.result)}`);
    }
    perCriterion.push({
      criterion: r.criterion,
      result: r.result,
      reason: typeof r.reason === 'string' ? r.reason : '',
    });
  }

  return {
    verdict,
    perCriterion,
    overallCritique: typeof obj.overall_critique === 'string' ? obj.overall_critique : '',
    suggestedNextStep: typeof obj.suggested_next_step === 'string' ? obj.suggested_next_step : '',
  };
}

// ─── User-facing formatter ────────────────────────────────────────────────

export function formatGradingReply(result: GradingResult, topicName: string): string {
  const lines: string[] = [];
  const headlineGlyph = result.verdict === 'pass' ? '✅' : '❌';
  const headlineWord = result.verdict === 'pass' ? 'PASS' : 'DID NOT PASS';
  lines.push(`${headlineGlyph} *${headlineWord}* — ${topicName}`);
  lines.push('');
  if (result.overallCritique) {
    lines.push(result.overallCritique);
    lines.push('');
  }
  lines.push('*Per criterion:*');
  for (const c of result.perCriterion) {
    const glyph = c.result === 'pass' ? '✓' : c.result === 'partial' ? '~' : '✗';
    lines.push(`  ${glyph} ${c.criterion} — _${c.result}_`);
    if (c.reason) lines.push(`    ${c.reason}`);
  }
  if (result.suggestedNextStep) {
    lines.push('');
    lines.push(`*Next:* ${result.suggestedNextStep}`);
  }
  lines.push('');
  if (result.verdict === 'pass') {
    lines.push('Topic marked completed. `/next` for what\'s next.');
  } else {
    lines.push('Try again — submit a new photo to re-grade, or `/skip` to move on.');
  }
  return lines.join('\n');
}
