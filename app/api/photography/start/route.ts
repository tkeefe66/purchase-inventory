import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { createSheetsClient, readMasterRows } from '../../../../lib/sheets.js';
import {
  appendAssignment,
  getActiveAssignment,
  upsertProgress,
} from '../../../../lib/photographySheets.js';
import { getTopicById } from '../../../../domains/photography/skillTree.js';
import { expandAssignment } from '../../../../domains/photography/expander.js';
import { filterToActivePhotography } from '../../../../domains/photography/inventory.js';
import { serializeCompact } from '../../../../domains/photography/serialize.js';
import { checkRateLimit, clientKey, overDailyBudget, recordSpend } from '../../../lib/apiGuards';
import { tooLargeByContentLength } from '../../../lib/httpGuards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (tooLargeByContentLength(req, 64 * 1024)) {
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

  let body: { topicId?: string };
  try {
    body = (await req.json()) as { topicId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const topicId = body.topicId?.trim();
  if (!topicId) {
    return NextResponse.json({ error: 'missing_topicId' }, { status: 400 });
  }
  const topic = getTopicById(topicId);
  if (!topic) {
    return NextResponse.json({ error: 'unknown_topic' }, { status: 404 });
  }

  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

  // One active assignment at a time — matches the bot's invariant.
  const existing = await getActiveAssignment(sheets, spreadsheetId);
  if (existing) {
    const existingTopic = getTopicById(existing.topicId);
    return NextResponse.json(
      {
        error: 'active_assignment_exists',
        activeTopicId: existing.topicId,
        activeTopicName: existingTopic?.name ?? existing.topicId,
      },
      { status: 409 },
    );
  }

  const allRows = await readMasterRows(sheets, spreadsheetId);
  const inventoryText = serializeCompact(filterToActivePhotography(allRows)).text;

  let expanded;
  try {
    expanded = await expandAssignment({ anthropic, inventoryText }, topic);
  } catch (err) {
    console.error('[api/photography/start] expandAssignment failed:', err);
    return NextResponse.json({ error: 'expander_failed' }, { status: 502 });
  }

  const now = new Date().toISOString();
  const assignmentId = randomUUID();
  await appendAssignment(sheets, spreadsheetId, {
    id: assignmentId,
    dateIssued: now,
    dateSubmitted: '',
    dateGraded: '',
    topicId: topic.id,
    assignmentText: expanded.assignmentText,
    rubricJson: JSON.stringify(expanded.rubric),
    status: 'active',
    submittedPhotoTelegramFileId: '',
    camera: '',
    lens: '',
    settingsExtracted: '',
    aiVerdict: '',
    aiCritique: '',
    perCriterionJson: '',
    retryCount: 0,
    userNotes: '',
    skippedReason: '',
  });
  await upsertProgress(sheets, spreadsheetId, topic.id, {
    status: 'in-progress',
    lastActivityAt: now,
  });

  recordSpend(0.02);
  return NextResponse.json({
    assignmentId,
    topicId: topic.id,
    topicName: topic.name,
    assignmentText: expanded.assignmentText,
    rubric: expanded.rubric,
  });
}
