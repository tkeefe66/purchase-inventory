export function tooLargeByContentLength(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(len) && len > maxBytes;
}
