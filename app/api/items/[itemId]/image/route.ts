import { NextResponse } from 'next/server';
import {
  saveItemImage,
  type SupportedMediaType,
} from '../../../../../lib/integrations/image-storage.js';
import {
  createSheetsClient,
  readMasterRows,
  updateRowFields,
} from '../../../../../lib/sheets.js';

export const runtime = 'nodejs';

function readEnv(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  spreadsheetId: string;
} {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_REFRESH_TOKEN'];
  const spreadsheetId = process.env['GOOGLE_SHEET_ID'];
  if (!clientId || !clientSecret || !refreshToken || !spreadsheetId) {
    throw new Error('Missing required env vars for Sheets access');
  }
  return { clientId, clientSecret, refreshToken, spreadsheetId };
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const { itemId } = await ctx.params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid form data' }, { status: 400 });
  }

  const file = form.get('image');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'missing image field' }, { status: 400 });
  }

  const mediaType = (file.type || '') as SupportedMediaType;
  const bytes = Buffer.from(await file.arrayBuffer());
  const saved = await saveItemImage(itemId, bytes, mediaType);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 400 });
  }

  let env: ReturnType<typeof readEnv>;
  try {
    env = readEnv();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'server misconfiguration' },
      { status: 500 },
    );
  }

  const sheets = createSheetsClient(env);
  const rows = await readMasterRows(sheets, env.spreadsheetId);
  const idx = rows.findIndex(
    (r) => `${r.orderId}|${r.productUrl || r.itemName}` === itemId,
  );
  if (idx === -1) {
    return NextResponse.json({ error: 'item not found' }, { status: 404 });
  }

  await updateRowFields(sheets, env.spreadsheetId, [
    { rowIndex: idx + 2, fields: { image: saved.path } },
  ]);

  return NextResponse.json({ ok: true, path: saved.path });
}
