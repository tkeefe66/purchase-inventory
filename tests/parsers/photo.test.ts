import { describe, test, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractFromPhoto } from '../../lib/parsers/photo.js';

const RUN = process.env.RUN_VISION_TESTS === '1';
const apiKey = process.env.ANTHROPIC_API_KEY;

const maybeDescribe = RUN && apiKey ? describe : describe.skip;

maybeDescribe('extractFromPhoto (live vision, skipped unless RUN_VISION_TESTS=1)', () => {
  test('extracts brand and itemName from a real gear photo', async () => {
    const fixturePath = path.join('tests', 'fixtures', 'photos', 'sample.jpg');
    const bytes = await readFile(fixturePath);
    const anthropic = new Anthropic({ apiKey: apiKey! });
    const result = await extractFromPhoto(anthropic, bytes, 'Patagonia Houdini');
    expect(result).not.toBeNull();
    expect(result!.brand.length).toBeGreaterThan(0);
    expect(result!.itemName.length).toBeGreaterThan(0);
    expect(['high', 'low']).toContain(result!.confidence.brand);
  }, 30_000);
});
