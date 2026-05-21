import { NextResponse } from 'next/server';
import { formatInTimeZone } from 'date-fns-tz';
import {
  appendRejectedImage,
  createSheetsClient,
  readMasterRows,
  updateRowFields,
} from '../../../../../../lib/sheets.js';

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

function classifySource(imageRef: string): string {
  if (imageRef.startsWith('/images/')) return 'local';
  try {
    return new URL(imageRef).host;
  } catch {
    return 'unknown';
  }
}

/**
 * Mark the row's current image as wrong. Appends a row to the "Rejected
 * Images" sheet tab capturing the bad URL, then clears the row's Image cell
 * so the UI reverts to the empty/upload state. Append happens BEFORE clear
 * so a failed log doesn't silently lose the rejected URL.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  const { itemId } = await ctx.params;

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

  const row = rows[idx]!;
  const currentImage = row.image.trim();
  if (!currentImage) {
    return NextResponse.json({ error: 'no image to reject' }, { status: 400 });
  }

  const rejectedAt = formatInTimeZone(new Date(), 'America/Denver', "yyyy-MM-dd'T'HH:mm:ssXXX");

  await appendRejectedImage(sheets, env.spreadsheetId, {
    orderId: row.orderId,
    productUrl: row.productUrl,
    itemName: row.itemName,
    rejectedUrl: currentImage,
    rejectedAt,
    sourceBefore: classifySource(currentImage),
  });

  await updateRowFields(sheets, env.spreadsheetId, [
    { rowIndex: idx + 2, fields: { image: '' } },
  ]);

  return NextResponse.json({ ok: true });
}
