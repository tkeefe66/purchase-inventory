import { NextResponse, type NextRequest } from 'next/server';
import { getPhotoBrain } from '../../../lib/photo-brain';
import {
  ChatBusyError,
  InvalidMessageError,
} from '../../../../domains/photography/chatService.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ messages: getPhotoBrain().history() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { message?: string; topicId?: string };
  try {
    body = (await req.json()) as { message?: string; topicId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body.message !== 'string') {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }
  console.log(
    `[api/photography/chat] message len=${body.message.length} topicId=${body.topicId ?? 'none'}`,
  );
  try {
    const reply = await getPhotoBrain().send(body.message, body.topicId);
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof InvalidMessageError) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
    if (err instanceof ChatBusyError) {
      return NextResponse.json({ error: 'busy' }, { status: 409 });
    }
    console.error('[api/photography/chat] agent error:', err);
    return NextResponse.json({ error: 'agent_error' }, { status: 502 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  getPhotoBrain().clear();
  return NextResponse.json({ ok: true });
}
