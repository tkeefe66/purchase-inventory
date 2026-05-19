/**
 * EXIF extraction for photo submissions. Wraps `exifr` to return a typed
 * shape with just the fields grading cares about. Tolerates missing /
 * partial EXIF (some files have none).
 *
 * Critically: Telegram strips EXIF from photos sent as compressed "Photo"
 * type. To preserve EXIF, Tom must send as Document/File. The bot detects
 * which path was used and prompts when EXIF is missing.
 */

import exifr from 'exifr';

export interface PhotoExif {
  /** Raw camera body name from EXIF Make + Model, e.g. "Sony ILCE-6700". */
  camera: string;
  /** Lens name from EXIF LensModel, e.g. "E PZ 18-50mm F2.8 DC DN | C". */
  lens: string;
  /** Aperture as a number, e.g. 2.8. Null if not present. */
  aperture: number | null;
  /** Shutter speed in seconds (decimal), e.g. 0.004 for 1/250. Null if absent. */
  shutterSeconds: number | null;
  /** ISO as a number. Null if absent. */
  iso: number | null;
  /** Focal length in mm (actual lens, not 35mm-equivalent). Null if absent. */
  focalLengthMm: number | null;
  /** 35mm-equivalent focal length, useful for cross-format comparison. Null if absent. */
  focalLength35mmEq: number | null;
  /** EXIF ExposureMode tag (0=auto, 1=manual, 2=auto-bracket). Null if absent. */
  exposureMode: number | null;
  /** EXIF WhiteBalance tag (0=auto, 1=manual). Null if absent. */
  whiteBalance: number | null;
  /** GPS lat/lng if the photo had them (Tom may strip). */
  gpsLat: number | null;
  gpsLng: number | null;
  /** When the photo was taken (camera clock). ISO string. */
  dateTimeOriginal: string | null;
}

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

/**
 * Extract EXIF from JPEG / TIFF bytes. Returns EMPTY when no EXIF or
 * parsing fails — never throws (camera files sometimes lie).
 */
export async function extractExif(bytes: Uint8Array | Buffer): Promise<PhotoExif> {
  let raw: Record<string, unknown> | null;
  try {
    raw = (await exifr.parse(bytes, { gps: true })) as Record<string, unknown> | null;
  } catch {
    return { ...EMPTY };
  }
  if (!raw) return { ...EMPTY };

  const get = <T>(key: string): T | null => {
    const v = raw![key];
    return v === undefined || v === null ? null : (v as T);
  };

  const make = (get<string>('Make') ?? '').trim();
  const model = (get<string>('Model') ?? '').trim();
  const camera = [make, model].filter(Boolean).join(' ').trim();

  const dt = get<Date | string>('DateTimeOriginal');
  let dateIso: string | null = null;
  if (dt instanceof Date && !Number.isNaN(dt.getTime())) dateIso = dt.toISOString();
  else if (typeof dt === 'string' && dt.trim()) dateIso = dt;

  return {
    camera,
    lens: (get<string>('LensModel') ?? '').trim(),
    aperture: get<number>('FNumber'),
    shutterSeconds: get<number>('ExposureTime'),
    iso: get<number>('ISO'),
    focalLengthMm: get<number>('FocalLength'),
    focalLength35mmEq: get<number>('FocalLengthIn35mmFilm'),
    exposureMode: get<number>('ExposureMode'),
    whiteBalance: get<number>('WhiteBalance'),
    gpsLat: get<number>('latitude'),
    gpsLng: get<number>('longitude'),
    dateTimeOriginal: dateIso,
  };
}

// ─── Display helpers ──────────────────────────────────────────────────────

/**
 * Render shutter speed as a photographer-friendly string. 0.004 → "1/250";
 * 1.5 → "1.5s"; null → "—".
 */
export function formatShutter(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  const denom = Math.round(1 / seconds);
  return `1/${denom}`;
}

export function formatAperture(fnumber: number | null): string {
  if (fnumber === null) return '—';
  return `f/${fnumber.toFixed(1).replace(/\.0$/, '')}`;
}

export function formatFocalLength(actualMm: number | null, eqMm: number | null): string {
  if (actualMm === null && eqMm === null) return '—';
  if (actualMm === null) return `${eqMm}mm (35mm-eq)`;
  if (eqMm === null) return `${actualMm}mm`;
  return `${actualMm}mm (${eqMm}mm full-frame eq.)`;
}

/**
 * One-line settings summary for inclusion in the grading prompt and the
 * user-facing reply: "f/8 · 1/250 · ISO 200 · 35mm (52mm eq.)".
 */
export function formatSettingsLine(exif: PhotoExif): string {
  const parts: string[] = [];
  parts.push(formatAperture(exif.aperture));
  parts.push(formatShutter(exif.shutterSeconds));
  if (exif.iso !== null) parts.push(`ISO ${exif.iso}`);
  parts.push(formatFocalLength(exif.focalLengthMm, exif.focalLength35mmEq));
  return parts.filter((p) => p !== '—').join(' · ');
}

/**
 * Best-effort check that the photo was shot on Tom's a6700. Used to flag
 * "you submitted an iPhone photo for an assignment about your a6700" cases.
 * Returns null when EXIF is missing (don't assume either way).
 */
export function isLikelyTomsA6700(exif: PhotoExif): boolean | null {
  if (!exif.camera) return null;
  // Sony names the a6700 as ILCE-6700 internally
  return /sony.*ilce-?6700|sony.*a6700/i.test(exif.camera);
}

/** True when the EXIF block has enough data to skip the "tell me your settings" prompt. */
export function hasUsableExif(exif: PhotoExif): boolean {
  // Need at least the three exposure-triangle settings to do meaningful grading.
  return exif.aperture !== null && exif.shutterSeconds !== null && exif.iso !== null;
}
