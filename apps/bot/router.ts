export interface RouterDeps {
  dispatchCommand: (chatId: string, text: string) => Promise<string | null>;
  handleAddgearContinuation: (chatId: string, text: string) => Promise<string | null>;
  handleAgentMessage: (chatId: string, text: string) => Promise<string>;
  handlePhoto: (chatId: string, photoFileId: string, caption: string) => Promise<string | null>;
}

const GENERIC_ERROR = "Sorry — something went wrong handling that. The error has been logged. Try again in a moment.";

export async function routeMessage(chatId: string, text: string, deps: RouterDeps): Promise<string> {
  try {
    // /cancel and other commands take precedence over an in-flight addgear flow
    const slashReply = await deps.dispatchCommand(chatId, text);
    if (slashReply !== null) return slashReply;

    // Mid-flow addgear continuation (plain-text replies like "2018" or "color: red")
    const addgearReply = await deps.handleAddgearContinuation(chatId, text);
    if (addgearReply !== null) return addgearReply;

    return await deps.handleAgentMessage(chatId, text);
  } catch (err) {
    console.error(`[router] error handling message from ${chatId}:`, err instanceof Error ? err.stack ?? err.message : err);
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
    return `Got a photo, but I only know what to do with photos captioned "/addgear". Send /help for options.`;
  } catch (err) {
    console.error(`[router] photo error from ${chatId}:`, err instanceof Error ? err.stack ?? err.message : err);
    return GENERIC_ERROR;
  }
}
