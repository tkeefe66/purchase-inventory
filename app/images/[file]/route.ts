import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';

const STORAGE_ROOT = process.env['IMAGE_STORAGE_ROOT'] ?? './local-data';

const TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await ctx.params;
  if (!/^[a-f0-9]{16}\.(jpg|jpeg|png|webp)$/.test(file)) {
    return new NextResponse('not found', { status: 404 });
  }
  const ext = file.split('.').pop() ?? 'jpg';
  const path = join(STORAGE_ROOT, 'images', file);
  try {
    await stat(path);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
  const bytes = await readFile(path);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'content-type': TYPE_BY_EXT[ext] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    },
  });
}
