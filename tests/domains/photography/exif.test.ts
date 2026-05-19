import { describe, test, expect } from 'vitest';
import {
  extractExif,
  formatShutter,
  formatAperture,
  formatFocalLength,
  formatSettingsLine,
  isLikelyTomsA6700,
  hasUsableExif,
  type PhotoExif,
} from '../../../domains/photography/exif.js';

const EMPTY: PhotoExif = {
  camera: '',
  lens: '',
  aperture: null,
  shutterSeconds: null,
  iso: null,
  focalLengthMm: null,
  focalLength35mmEq: null,
  exposureMode: null,
  whiteBalance: null,
  gpsLat: null,
  gpsLng: null,
  dateTimeOriginal: null,
};

describe('extractExif', () => {
  test('returns empty shape on non-image bytes', async () => {
    const bytes = Buffer.from('not a real image');
    const out = await extractExif(bytes);
    expect(out).toEqual(EMPTY);
  });

  test('returns empty shape on truly empty buffer', async () => {
    const out = await extractExif(Buffer.alloc(0));
    expect(out).toEqual(EMPTY);
  });
});

describe('formatShutter', () => {
  test.each([
    [null, '—'],
    [0.004, '1/250'],
    [0.008, '1/125'],
    [0.5, '1/2'],
    [1, '1.0s'],
    [1.5, '1.5s'],
    [30, '30.0s'],
  ])('%p → %p', (input, expected) => {
    expect(formatShutter(input)).toBe(expected);
  });
});

describe('formatAperture', () => {
  test.each([
    [null, '—'],
    [2.8, 'f/2.8'],
    [4, 'f/4'],
    [11, 'f/11'],
    [1.4, 'f/1.4'],
  ])('%p → %p', (input, expected) => {
    expect(formatAperture(input)).toBe(expected);
  });
});

describe('formatFocalLength', () => {
  test('shows actual + equivalent when both present', () => {
    expect(formatFocalLength(35, 52)).toBe('35mm (52mm full-frame eq.)');
  });
  test('shows actual alone when equivalent missing', () => {
    expect(formatFocalLength(35, null)).toBe('35mm');
  });
  test('shows equivalent alone when actual missing', () => {
    expect(formatFocalLength(null, 52)).toBe('52mm (35mm-eq)');
  });
  test('em-dash when both missing', () => {
    expect(formatFocalLength(null, null)).toBe('—');
  });
});

describe('formatSettingsLine', () => {
  test('one-line summary with all four parts', () => {
    const exif: PhotoExif = {
      ...EMPTY, aperture: 8, shutterSeconds: 0.004, iso: 200, focalLengthMm: 35, focalLength35mmEq: 52,
    };
    expect(formatSettingsLine(exif)).toBe('f/8 · 1/250 · ISO 200 · 35mm (52mm full-frame eq.)');
  });

  test('drops em-dash placeholders when EXIF is sparse', () => {
    const exif: PhotoExif = { ...EMPTY, aperture: 8, iso: 200 };
    const out = formatSettingsLine(exif);
    expect(out).toContain('f/8');
    expect(out).toContain('ISO 200');
    expect(out).not.toContain('—');
  });
});

describe('isLikelyTomsA6700', () => {
  test.each([
    ['Sony ILCE-6700', true],
    ['Sony ILCE6700', true],
    ['Sony a6700', true],
    ['SONY ILCE-7M4', false],
    ['Apple iPhone 15 Pro', false],
    ['', null],
  ])('%p → %p', (camera, expected) => {
    expect(isLikelyTomsA6700({ ...EMPTY, camera })).toBe(expected);
  });
});

describe('hasUsableExif', () => {
  test('true only when all three exposure-triangle settings present', () => {
    expect(hasUsableExif({ ...EMPTY, aperture: 8, shutterSeconds: 0.004, iso: 200 })).toBe(true);
    expect(hasUsableExif({ ...EMPTY, aperture: 8, shutterSeconds: 0.004 })).toBe(false);
    expect(hasUsableExif({ ...EMPTY })).toBe(false);
  });
});
