import { describe, test, expect, vi } from 'vitest';
import {
  gradePhoto,
  buildUserPrompt,
  parseGradingResponse,
  formatGradingReply,
  type GradingInput,
  type GradingResult,
  type GradingDeps,
} from '../../../domains/photography/grading.js';
import type { RubricCriterion } from '../../../domains/photography/expander.js';
import type { PhotoExif } from '../../../domains/photography/exif.js';

const RUBRIC: RubricCriterion[] = [
  { criterion: 'frames at golden hour', description: 'visible warm low light', is_core: true },
  { criterion: 'three-layer composition', description: 'foreground / middle / background', is_core: true },
  { criterion: 'caption explains intent', description: '', is_core: false },
];

const EXIF: PhotoExif = {
  camera: 'Sony ILCE-6700',
  lens: 'E PZ 18-50mm F2.8 DC DN | C',
  aperture: 8,
  shutterSeconds: 0.004,
  iso: 200,
  focalLengthMm: 35,
  focalLength35mmEq: 52,
  exposureMode: 1,
  whiteBalance: 0,
  gpsLat: 40.014,
  gpsLng: -105.27,
  dateTimeOriginal: '2026-05-19T19:42:00.000Z',
};

const INPUT: GradingInput = {
  assignmentText: 'Take three landscape frames at golden hour.',
  rubric: RUBRIC,
  camera: EXIF.camera,
  lens: EXIF.lens,
  exif: EXIF,
  userNotes: 'Shot at Chautauqua near sunset.',
  imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), // JPEG magic bytes
  imageMimeType: 'image/jpeg',
};

// ─── buildUserPrompt ──────────────────────────────────────────────────────

describe('buildUserPrompt', () => {
  test('includes assignment, rubric with CORE markers, gear, and caption', () => {
    const out = buildUserPrompt(INPUT);
    expect(out).toContain('Take three landscape frames at golden hour.');
    expect(out).toContain('1. frames at golden hour (CORE)');
    expect(out).toContain('2. three-layer composition (CORE)');
    expect(out).toContain('3. caption explains intent');
    expect(out).toContain('Camera: Sony ILCE-6700');
    expect(out).toContain('f/8');
    expect(out).toContain('1/250');
    expect(out).toContain('ISO 200');
    expect(out).toContain('Shot at Chautauqua near sunset.');
  });

  test('reports manual settings when EXIF missing', () => {
    const out = buildUserPrompt({
      ...INPUT,
      exif: null,
      manualSettings: 'a6700 / Sigma 18-50 / f/8 / 1/250 / ISO 200',
    });
    expect(out).toContain('user-stated; EXIF was stripped');
    expect(out).toContain('a6700 / Sigma 18-50');
  });

  test('reports "settings unknown" when no EXIF and no manual', () => {
    const { manualSettings: _omit, ...rest } = INPUT;
    const out = buildUserPrompt({ ...rest, exif: null, userNotes: '' });
    expect(out).toContain('Settings: (unknown');
  });

  test('omits Tom\'s caption section when empty', () => {
    const out = buildUserPrompt({ ...INPUT, userNotes: '' });
    expect(out).not.toContain("## Tom's caption");
  });
});

// ─── parseGradingResponse ─────────────────────────────────────────────────

describe('parseGradingResponse', () => {
  test('parses well-formed fenced JSON', () => {
    const text = '```json\n' + JSON.stringify({
      verdict: 'pass',
      per_criterion: [
        { criterion: 'a', result: 'pass', reason: 'sharp' },
        { criterion: 'b', result: 'partial', reason: 'mostly there' },
      ],
      overall_critique: 'Solid frame.',
      suggested_next_step: 'Try f/4 next time.',
    }) + '\n```';
    const r = parseGradingResponse(text);
    expect(r.verdict).toBe('pass');
    expect(r.perCriterion).toHaveLength(2);
    expect(r.perCriterion[0]!.result).toBe('pass');
    expect(r.perCriterion[1]!.result).toBe('partial');
    expect(r.overallCritique).toBe('Solid frame.');
    expect(r.suggestedNextStep).toBe('Try f/4 next time.');
  });

  test('parses bare JSON (no fence)', () => {
    const text = JSON.stringify({
      verdict: 'did_not_pass',
      per_criterion: [{ criterion: 'x', result: 'fail', reason: '' }],
      overall_critique: '',
      suggested_next_step: '',
    });
    expect(parseGradingResponse(text).verdict).toBe('did_not_pass');
  });

  test('throws on invalid verdict', () => {
    const text = '```json\n' + JSON.stringify({
      verdict: 'maybe',
      per_criterion: [{ criterion: 'x', result: 'pass' }],
    }) + '\n```';
    expect(() => parseGradingResponse(text)).toThrow(/verdict/);
  });

  test('throws on invalid per_criterion result', () => {
    const text = '```json\n' + JSON.stringify({
      verdict: 'pass',
      per_criterion: [{ criterion: 'x', result: 'great' }],
    }) + '\n```';
    expect(() => parseGradingResponse(text)).toThrow(/result must be/);
  });

  test('throws on missing per_criterion array', () => {
    const text = '```json\n' + JSON.stringify({ verdict: 'pass', per_criterion: [] }) + '\n```';
    expect(() => parseGradingResponse(text)).toThrow(/non-empty array/);
  });

  test('throws on non-JSON', () => {
    expect(() => parseGradingResponse('just text')).toThrow(/non-JSON/);
  });
});

// ─── formatGradingReply ───────────────────────────────────────────────────

describe('formatGradingReply', () => {
  test('shows PASS banner + critique + per-criterion + next-step for a passing verdict', () => {
    const r: GradingResult = {
      verdict: 'pass',
      perCriterion: [
        { criterion: 'a', result: 'pass', reason: 'sharp' },
        { criterion: 'b', result: 'pass', reason: 'clean' },
      ],
      overallCritique: 'Solid work.',
      suggestedNextStep: 'Try f/4 next time.',
    };
    const out = formatGradingReply(r, 'Exposure Triangle');
    expect(out).toContain('✅');
    expect(out).toContain('PASS');
    expect(out).toContain('Exposure Triangle');
    expect(out).toContain('Solid work.');
    expect(out).toMatch(/✓ a/);
    expect(out).toContain('Try f/4 next time.');
    expect(out).toContain('Topic marked completed');
  });

  test('shows DID NOT PASS for failing verdict + invites retry', () => {
    const r: GradingResult = {
      verdict: 'did_not_pass',
      perCriterion: [{ criterion: 'a', result: 'fail', reason: 'blurry' }],
      overallCritique: 'Focus is off.',
      suggestedNextStep: 'Use AF-S + spot.',
    };
    const out = formatGradingReply(r, 'Focus Modes');
    expect(out).toContain('❌');
    expect(out).toContain('DID NOT PASS');
    expect(out).toMatch(/✗ a/);
    expect(out).toContain('Try again');
  });
});

// ─── gradePhoto (mocked Anthropic) ────────────────────────────────────────

function mockAnthropic(text: string): GradingDeps['anthropic'] {
  const create = vi.fn(async () => ({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
  } as never));
  return { messages: { create } } as unknown as GradingDeps['anthropic'];
}

describe('gradePhoto (mocked)', () => {
  test('returns parsed GradingResult on a well-formed response', async () => {
    const json = {
      verdict: 'pass',
      per_criterion: [
        { criterion: 'frames at golden hour', result: 'pass', reason: 'warm low light visible' },
        { criterion: 'three-layer composition', result: 'pass', reason: 'fg / mid / bg present' },
        { criterion: 'caption explains intent', result: 'pass', reason: 'caption present' },
      ],
      overall_critique: 'Frame composition is clean and light is correct.',
      suggested_next_step: 'Try a wider aperture for more separation next time.',
    };
    const text = '```json\n' + JSON.stringify(json) + '\n```';
    const anthropic = mockAnthropic(text);
    const out = await gradePhoto({ anthropic }, INPUT);
    expect(out.verdict).toBe('pass');
    expect(out.perCriterion).toHaveLength(3);
  });

  test('rejects unsupported MIME types', async () => {
    await expect(
      gradePhoto({ anthropic: mockAnthropic('') }, { ...INPUT, imageMimeType: 'image/x-sony-arw' }),
    ).rejects.toThrow(/Unsupported image MIME/);
  });
});
