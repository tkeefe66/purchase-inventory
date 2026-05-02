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

export interface TelegramUpdateMessage {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string; first_name?: string; username?: string };
  date: number;
  text?: string;
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

export async function getUpdates(cfg: TelegramConfig): Promise<TelegramUpdate[]> {
  const resp = await fetch(`${TELEGRAM_API_BASE}/bot${cfg.botToken}/getUpdates`);
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
