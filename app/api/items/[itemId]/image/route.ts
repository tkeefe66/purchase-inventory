import { NextResponse } from 'next/server';
import {
  downloadAndSave,
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

/**
 * Two write paths:
 *   - form field `image` (Blob): user uploaded a file from the device. Bytes
 *     saved to /data/images/<id>.<ext>; sheet's Image column gets the local
 *     /images/<id>.<ext> path.
 *   - form field `url`  (string): user pasted a URL of a product image
 *     they found online. Bytes still downloaded to /data as a hedge against
 *     URL rot, but the sheet's Image column gets the *source URL* — matching
 *     the cron + backfill convention.
 */
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

  const urlField = form.get('url');
  const file = form.get('image');

  let imageRefForSheet: string;
  if (typeof urlField === 'string' && urlField.trim().length > 0) {
    const url = urlField.trim();
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'invalid url' }, { status: 400 });
    }
    const saved = await downloadAndSave(itemId, url);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }
    imageRefForSheet = url;
  } else if (file instanceof Blob) {
    const mediaType = (file.type || '') as SupportedMediaType;
    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = await saveItemImage(itemId, bytes, mediaType);
    if (!saved.ok) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }
    imageRefForSheet = saved.path;
  } else {
    return NextResponse.json(
      { error: 'missing image or url field' },
      { status: 400 },
    );
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
    { rowIndex: idx + 2, fields: { image: imageRefForSheet } },
  ]);

  return NextResponse.json({ ok: true, image: imageRefForSheet });
}
