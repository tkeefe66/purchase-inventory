export interface RouterDeps {
  dispatchCommand: (chatId: string, text: string) => Promise<string | null>;
  handleAgentMessage: (chatId: string, text: string) => Promise<string>;
}

const GENERIC_ERROR = "Sorry — something went wrong handling that. The error has been logged. Try again in a moment.";

export async function routeMessage(chatId: string, text: string, deps: RouterDeps): Promise<string> {
  try {
    const slashReply = await deps.dispatchCommand(chatId, text);
    if (slashReply !== null) return slashReply;
    return await deps.handleAgentMessage(chatId, text);
  } catch (err) {
    console.error(`[router] error handling message from ${chatId}:`, err instanceof Error ? err.stack ?? err.message : err);
    return GENERIC_ERROR;
  }
}
