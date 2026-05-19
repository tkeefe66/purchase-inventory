import type { gmail_v1 } from 'googleapis';

/**
 * Recursively walks the MIME tree to find the first `text/html` part and
 * returns its body decoded from base64url to UTF-8.
 *
 * Falls back to `text/plain` if no HTML part exists. Returns empty string if
 * neither is present (e.g. degenerate / encrypted payloads).
 */
export function extractHtmlBody(message: gmail_v1.Schema$Message): string {
  const payload = message.payload;
  if (!payload) return '';

  const html = walk(payload, 'text/html');
  if (html) return html;
  const plain = walk(payload, 'text/plain');
  return plain ?? '';
}

function walk(part: gmail_v1.Schema$MessagePart, mimeType: string): string | null {
  if (part.mimeType === mimeType && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8');
  }
  if (part.parts) {
    for (const p of part.parts) {
      const found = walk(p, mimeType);
      if (found) return found;
    }
  }
  return null;
}
