export interface TelegramConfig {
  botToken: string;
}

export interface TelegramMessage {
  chat_id: number | string;
  text: string;
  parse_mode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  disable_notification?: boolean;
  link_preview_options?: { is_disabled?: boolean };
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramUpdateMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string; first_name?: string; username?: string };
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramUpdateMessage;
  edited_message?: TelegramUpdateMessage;
}

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export async function sendMessage(
  cfg: TelegramConfig,
  msg: TelegramMessage,
): Promise<void> {
  const resp = await fetch(`${TELEGRAM_API_BASE}/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(msg),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram sendMessage failed (HTTP ${resp.status}): ${body}`);
  }
}

export interface GetUpdatesOptions {
  offset?: number;
  timeout?: number;
}

export async function getUpdates(cfg: TelegramConfig, opts: GetUpdatesOptions = {}): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams();
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.timeout !== undefined) params.set('timeout', String(opts.timeout));
  const qs = params.toString();
  const url = `${TELEGRAM_API_BASE}/bot${cfg.botToken}/getUpdates${qs ? `?${qs}` : ''}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram getUpdates failed (HTTP ${resp.status}): ${body}`);
  }
  const data = (await resp.json()) as { ok: boolean; result?: TelegramUpdate[]; description?: string };
  if (!data.ok) {
    throw new Error(`Telegram getUpdates returned ok=false: ${data.description ?? 'unknown'}`);
  }
  return data.result ?? [];
}

export async function getMe(cfg: TelegramConfig): Promise<{ id: number; username?: string; first_name?: string }> {
  const resp = await fetch(`${TELEGRAM_API_BASE}/bot${cfg.botToken}/getMe`);
  if (!resp.ok) throw new Error(`Telegram getMe failed (HTTP ${resp.status})`);
  const data = (await resp.json()) as { ok: boolean; result: { id: number; username?: string; first_name?: string } };
  return data.result;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
}

export async function getFile(cfg: TelegramConfig, fileId: string): Promise<TelegramFile> {
  const resp = await fetch(
    `${TELEGRAM_API_BASE}/bot${cfg.botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram getFile failed (HTTP ${resp.status}): ${body}`);
  }
  const data = (await resp.json()) as { ok: boolean; result: TelegramFile; description?: string };
  if (!data.ok) throw new Error(`Telegram getFile returned ok=false: ${data.description ?? 'unknown'}`);
  if (!data.result.file_path) throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
  return data.result;
}

export async function downloadFile(cfg: TelegramConfig, filePath: string): Promise<Buffer> {
  const resp = await fetch(`${TELEGRAM_API_BASE}/file/bot${cfg.botToken}/${filePath}`);
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram downloadFile failed (HTTP ${resp.status}): ${body}`);
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}
