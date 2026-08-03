import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSheetsClient } from '../../../../lib/sheets.js';
import {
  getActiveAssignment,
  readProgress,
  updateAssignment,
  upsertProgress,
} from '../../../../lib/photographySheets.js';
import { gradePhoto } from '../../../../domains/photography/grading.js';
import {
  extractExif,
  hasUsableExif,
  type PhotoExif,
} from '../../../../domains/photography/exif.js';
import { applyProgressUpdate, type ProgressEntry } from '../../../../domains/photography/curriculum.js';
import { getTopicById } from '../../../../domains/photography/skillTree.js';
import type { RubricCriterion } from '../../../../domains/photography/expander.js';
import { checkRateLimit, clientKey, overDailyBudget, recordSpend } from '../../../lib/apiGuards';
import { tooLargeByContentLength } from '../../../lib/httpGuards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_MIME = /^image\/(jpeg|png|webp|gif)$/i;
const ARW_RE = /image\/x-(sony-)?arw|image\/arw|\.arw$/i;
const MAX_BYTES = 20 * 1024 * 1024; // 20MB matches Anthropic vision cap

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (tooLargeByContentLength(req, 20 * 1024 * 1024)) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  const rl = checkRateLimit(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json({ error: 'rate_limited' }, {
      status: 429,
      headers: { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) },
    });
  }
  if (overDailyBudget()) {
    return NextResponse.json({ error: 'daily_budget_exceeded' }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_multipart' }, { status: 400 });
  }

  const file = form.get('image');
  const caption = String(form.get('caption') ?? '').trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_image' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_image' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'image_too_large', maxBytes: MAX_BYTES, gotBytes: file.size },
      { status: 413 },
    );
  }
  const mime = file.type || 'application/octet-stream';
  if (ARW_RE.test(mime) || ARW_RE.test(file.name)) {
    return NextResponse.json({ error: 'arw_rejected' }, { status: 415 });
  }
  if (!SUPPORTED_MIME.test(mime)) {
    return NextResponse.json({ error: 'unsupported_mime', mime }, { status: 415 });
  }

  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  const active = await getActiveAssignment(sheets, spreadsheetId);
  if (!active) {
    return NextResponse.json({ error: 'no_active_assignment' }, { status: 409 });
  }
  if (active.retryCount >= 5) {
    return NextResponse.json({ error: 'retry_limit' }, { status: 429 });
  }

  let rubric: RubricCriterion[];
  try {
    const parsed = JSON.parse(active.rubricJson || '[]') as unknown;
    if (!Array.isArray(parsed)) throw new Error('rubric_json is not an array');
    rubric = parsed as RubricCriterion[];
  } catch (err) {
    console.error('[api/photography/submit] invalid rubric_json on active assignment:', err);
    return NextResponse.json({ error: 'corrupted_rubric' }, { status: 500 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const exif: PhotoExif = await extractExif(bytes);
  const camera = exif.camera || active.camera || '';
  const lens = exif.lens || active.lens || '';
  const isRetry = active.status === 'submitted' || active.status === 'did_not_pass';
  const now = new Date().toISOString();

  // Mark as submitted before grading so a slow/failed grade leaves an audit
  // trail — same contract the bot's handleSubmission uses.
  await updateAssignment(sheets, spreadsheetId, active.rowIndex, {
    status: 'submitted',
    dateSubmitted: now,
    submittedPhotoTelegramFileId: '', // web-uploaded; no Telegram file id
    camera,
    lens,
    settingsExtracted: JSON.stringify({
      aperture: exif.aperture,
      shutterSeconds: exif.shutterSeconds,
      iso: exif.iso,
      focalLengthMm: exif.focalLengthMm,
      focalLength35mmEq: exif.focalLength35mmEq,
      gpsLat: exif.gpsLat,
      gpsLng: exif.gpsLng,
      dateTimeOriginal: exif.dateTimeOriginal,
    }),
    userNotes: caption,
    retryCount: isRetry ? active.retryCount + 1 : active.retryCount,
  });

  let result;
  try {
    result = await gradePhoto(
      { anthropic },
      {
        assignmentText: active.assignmentText,
        rubric,
        camera,
        lens,
        exif: hasUsableExif(exif) ? exif : null,
        manualSettings: caption,
        userNotes: caption,
        imageBytes: bytes,
        imageMimeType: mime,
      },
    );
  } catch (err) {
    console.error('[api/photography/submit] gradePhoto failed:', err);
    return NextResponse.json({ error: 'grader_failed' }, { status: 502 });
  }
  recordSpend(0.05);

  await updateAssignment(sheets, spreadsheetId, active.rowIndex, {
    status: result.verdict === 'pass' ? 'passed' : 'did_not_pass',
    dateGraded: now,
    aiVerdict: result.verdict === 'pass' ? 'pass' : 'did_not_pass',
    aiCritique: result.overallCritique,
    perCriterionJson: JSON.stringify(result.perCriterion),
  });

  const progRows = await readProgress(sheets, spreadsheetId);
  const current = progRows.find((r) => r.topicId === active.topicId);
  const entry: ProgressEntry | null = current
    ? {
        topicId: current.topicId,
        status: current.status,
        lastActivityAt: current.lastActivityAt,
        assignmentsPassed: current.assignmentsPassed,
        assignmentsFailed: current.assignmentsFailed,
        theoryLastReadAt: current.theoryLastReadAt,
      }
    : null;
  const event = result.verdict === 'pass'
    ? { kind: 'assignment-passed' as const }
    : { kind: 'assignment-failed' as const };
  const nextEntry = applyProgressUpdate(entry, active.topicId, event, now);
  await upsertProgress(sheets, spreadsheetId, active.topicId, {
    status: nextEntry.status,
    lastActivityAt: nextEntry.lastActivityAt,
    assignmentsPassed: nextEntry.assignmentsPassed,
    assignmentsFailed: nextEntry.assignmentsFailed,
    theoryLastReadAt: nextEntry.theoryLastReadAt,
  });

  const topic = getTopicById(active.topicId);
  return NextResponse.json({
    topicId: active.topicId,
    topicName: topic?.name ?? active.topicId,
    verdict: result.verdict,
    overallCritique: result.overallCritique,
    suggestedNextStep: result.suggestedNextStep,
    perCriterion: result.perCriterion,
  });
}
