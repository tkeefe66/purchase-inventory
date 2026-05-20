import { NextResponse } from 'next/server';
import { createSheetsClient } from '../../../../lib/sheets.js';
import {
  getActiveAssignment,
  readProgress,
  updateAssignment,
  upsertProgress,
} from '../../../../lib/photographySheets.js';
import { getTopicById } from '../../../../domains/photography/skillTree.js';
import { applyProgressUpdate, type ProgressEntry } from '../../../../domains/photography/curriculum.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const sheets = createSheetsClient({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
  });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;

  const active = await getActiveAssignment(sheets, spreadsheetId);
  if (!active) {
    return NextResponse.json({ ok: false, error: 'no_active_assignment' }, { status: 404 });
  }

  const now = new Date().toISOString();
  await updateAssignment(sheets, spreadsheetId, active.rowIndex, {
    status: 'skipped',
    skippedReason: 'user web /skip',
    dateGraded: now,
  });

  const prog = await readProgress(sheets, spreadsheetId);
  const current = prog.find((r) => r.topicId === active.topicId);
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
  const next = applyProgressUpdate(entry, active.topicId, { kind: 'skipped' }, now);
  await upsertProgress(sheets, spreadsheetId, active.topicId, {
    status: next.status,
    lastActivityAt: next.lastActivityAt,
    assignmentsPassed: next.assignmentsPassed,
    assignmentsFailed: next.assignmentsFailed,
    theoryLastReadAt: next.theoryLastReadAt,
  });

  const topic = getTopicById(active.topicId);
  return NextResponse.json({
    ok: true,
    skippedTopicId: active.topicId,
    skippedTopicName: topic?.name ?? active.topicId,
  });
}
