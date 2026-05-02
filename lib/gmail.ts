import { google, gmail_v1 } from 'googleapis';

export interface GmailClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export type GmailClient = gmail_v1.Gmail;

export function createGmailClient(cfg: GmailClientConfig): GmailClient {
  const oauth2Client = new google.auth.OAuth2(cfg.clientId, cfg.clientSecret);
  oauth2Client.setCredentials({ refresh_token: cfg.refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface ListMessagesOptions {
  query: string;
  maxResults?: number;
}

export async function listMessages(
  gmail: GmailClient,
  opts: ListMessagesOptions,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const resp = await gmail.users.messages.list({
      userId: 'me',
      q: opts.query,
      maxResults: opts.maxResults ?? 100,
      ...(pageToken ? { pageToken } : {}),
    });
    for (const m of resp.data.messages ?? []) {
      if (m.id) ids.push(m.id);
      if (opts.maxResults && ids.length >= opts.maxResults) return ids;
    }
    pageToken = resp.data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

export async function getMessage(
  gmail: GmailClient,
  messageId: string,
): Promise<gmail_v1.Schema$Message> {
  const resp = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return resp.data;
}

export function getHeader(
  message: gmail_v1.Schema$Message,
  name: string,
): string | undefined {
  const headers = message.payload?.headers ?? [];
  const lc = name.toLowerCase();
  for (const h of headers) {
    if (h.name && h.name.toLowerCase() === lc) return h.value ?? undefined;
  }
  return undefined;
}

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

/**
 * Ensures a Gmail label exists; returns its labelId. Idempotent.
 */
export async function ensureLabel(gmail: GmailClient, labelName: string): Promise<string> {
  const resp = await gmail.users.labels.list({ userId: 'me' });
  const existing = resp.data.labels?.find((l) => l.name === labelName);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });
  if (!created.data.id) throw new Error(`Failed to create label "${labelName}"`);
  return created.data.id;
}

export async function applyLabel(
  gmail: GmailClient,
  messageId: string,
  labelId: string,
): Promise<void> {
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: { addLabelIds: [labelId] },
  });
}
