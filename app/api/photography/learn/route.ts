import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createSheetsClient, readMasterRows } from '../../../../lib/sheets.js';
import { upsertProgress } from '../../../../lib/photographySheets.js';
import { getTopicById } from '../../../../domains/photography/skillTree.js';
import { expandLesson } from '../../../../domains/photography/expander.js';
import { filterToActivePhotography } from '../../../../domains/photography/inventory.js';
import { serializeCompact } from '../../../../domains/photography/serialize.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  const allRows = await readMasterRows(sheets, spreadsheetId);
  const inventoryText = serializeCompact(filterToActivePhotography(allRows)).text;

  let lesson: string;
  try {
    lesson = await expandLesson({ anthropic, inventoryText }, topic);
  } catch (err) {
    console.error('[api/photography/learn] expandLesson failed:', err);
    return NextResponse.json({ error: 'expander_failed' }, { status: 502 });
  }

  // Same side effect the bot's handleLearn applies — bump the theory-read
  // timestamp so the curriculum view reflects activity.
  try {
    await upsertProgress(sheets, spreadsheetId, topic.id, {
      theoryLastReadAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[api/photography/learn] upsertProgress failed (non-fatal):', err);
  }

  return NextResponse.json({ topicId: topic.id, topicName: topic.name, lesson });
}
