export interface MetaSendResult {
  success: boolean;
  messageId?: string;
  recipientId?: string;
  error?: string;
  retryable?: boolean;
}

interface MetaApiResponse {
  recipient_id?: string;
  message_id?: string;
  error?: { message?: string; code?: number; is_transient?: boolean };
}

const API_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || "v26.0";

function buildMessage(text: string, buttonText?: string | null, buttonUrl?: string | null): { text: string } {
  const normalized = text.trim();
  if (!normalized) throw new Error("A Meta message cannot be empty");
  if (buttonText && buttonUrl) {
    return { text: `${normalized}\n\n${buttonText}: ${buttonUrl}` };
  }
  return { text: normalized };
}

async function send(
  instagramAccountId: string,
  recipient: Record<string, string>,
  messageText: string,
  accessToken: string,
  buttonText?: string | null,
  buttonUrl?: string | null,
): Promise<MetaSendResult> {
  if (!instagramAccountId || !accessToken) {
    return { success: false, error: "Instagram account ID or access token is missing", retryable: false };
  }

  try {
    const response = await fetch(`https://graph.instagram.com/${API_VERSION}/${instagramAccountId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ recipient, message: buildMessage(messageText, buttonText, buttonUrl) }),
    });
    const payload = await response.json() as MetaApiResponse;
    if (response.ok && !payload.error) {
      return { success: true, messageId: payload.message_id, recipientId: payload.recipient_id };
    }

    const code = payload.error?.code;
    return {
      success: false,
      error: payload.error?.message || `Meta Send API failed with ${response.status}`,
      retryable: response.status === 429 || response.status >= 500 || payload.error?.is_transient === true || code === 4 || code === 17,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Meta Send API network error",
      retryable: true,
    };
  }
}

/** Sends one compliant private reply to the person who created a comment. */
export function sendPrivateReply(
  instagramAccountId: string,
  commentId: string,
  messageText: string,
  accessToken: string,
  buttonText?: string | null,
  buttonUrl?: string | null,
): Promise<MetaSendResult> {
  return send(instagramAccountId, { comment_id: commentId }, messageText, accessToken, buttonText, buttonUrl);
}

/** Sends a direct reply only after the recipient has an eligible Instagram messaging conversation. */
export function sendDirectMessage(
  instagramAccountId: string,
  recipientId: string,
  messageText: string,
  accessToken: string,
  buttonText?: string | null,
  buttonUrl?: string | null,
): Promise<MetaSendResult> {
  return send(instagramAccountId, { id: recipientId }, messageText, accessToken, buttonText, buttonUrl);
}
