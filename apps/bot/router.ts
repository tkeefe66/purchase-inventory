import type { DomainMode } from '../../lib/stickyMode.js';

export interface RouterDeps {
  dispatchCommand: (chatId: string, text: string) => Promise<string | null>;
  handleAddgearContinuation: (chatId: string, text: string) => Promise<string | null>;
  handleCampingSelection: (chatId: string, text: string) => Promise<string | null>;
  handleOutdoorAgentMessage: (chatId: string, text: string) => Promise<string>;
  handlePhotographyAgentMessage: (chatId: string, text: string) => Promise<string>;
  handlePhoto: (chatId: string, photoFileId: string, caption: string) => Promise<string | null>;
  handleDocument: (chatId: string, fileId: string, mimeType: string, fileName: string, caption: string) => Promise<string>;
  getStickyMode: (chatId: string) => DomainMode;
}

const GENERIC_ERROR =
  "Sorry — something went wrong handling that. The error has been logged. Try again in a moment.";

export async function routeMessage(chatId: string, text: string, deps: RouterDeps): Promise<string> {
  try {
    // Slash commands handle their own domain semantics (incl. /photo, /outdoor, /who,
    // per-message overrides like "/photo <body>", and "/cancel" interrupting addgear).
    const slashReply = await deps.dispatchCommand(chatId, text);
    if (slashReply !== null) return slashReply;

    // Mid-flow continuations are mode-agnostic — they only fire when a flow is
    // already in progress for this chat, so they can run regardless of sticky mode.
    const campingReply = await deps.handleCampingSelection(chatId, text);
    if (campingReply !== null) return campingReply;

    const addgearReply = await deps.handleAddgearContinuation(chatId, text);
    if (addgearReply !== null) return addgearReply;

    // Sticky-mode fallback for plain text.
    const mode = deps.getStickyMode(chatId);
    if (mode === 'photography') {
      return await deps.handlePhotographyAgentMessage(chatId, text);
    }
    return await deps.handleOutdoorAgentMessage(chatId, text);
  } catch (err) {
    console.error(
      `[router] error handling message from ${chatId}:`,
      err instanceof Error ? err.stack ?? err.message : err,
    );
    return GENERIC_ERROR;
  }
}

export async function routePhoto(
  chatId: string,
  photoFileId: string,
  caption: string,
  deps: RouterDeps,
): Promise<string> {
  try {
    const reply = await deps.handlePhoto(chatId, photoFileId, caption);
    if (reply !== null) return reply;
    return `Got a photo, but I only know what to do with photos captioned "/addgear ...".`;
  } catch (err) {
    console.error(
      `[router] photo error from ${chatId}:`,
      err instanceof Error ? err.stack ?? err.message : err,
    );
    return GENERIC_ERROR;
  }
}

/**
 * Telegram Documents (i.e. photos sent as files, preserving EXIF) auto-route
 * to the photography domain regardless of sticky mode. The handler decides
 * what to do based on mime type — image/* gets the grading flow, anything
 * else gets a "send images only" reply.
 */
export async function routeDocument(
  chatId: string,
  fileId: string,
  mimeType: string,
  fileName: string,
  caption: string,
  deps: RouterDeps,
): Promise<string> {
  try {
    return await deps.handleDocument(chatId, fileId, mimeType, fileName, caption);
  } catch (err) {
    console.error(
      `[router] document error from ${chatId}:`,
      err instanceof Error ? err.stack ?? err.message : err,
    );
    return GENERIC_ERROR;
  }
}
