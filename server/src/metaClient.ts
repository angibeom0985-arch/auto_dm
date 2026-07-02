import dotenv from "dotenv";

dotenv.config();

export interface MetaSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface MetaApiResponse {
  id?: string;
  message_id?: string;
  error?: {
    message: string;
  };
}

/**
 * Sends a Private Reply to a specific Instagram comment via Meta Graph API
 * API Reference: POST /v20.0/{comment_id}/private_replies
 */
export async function sendPrivateReply(
  commentId: string,
  messageText: string,
  accessToken: string,
  buttonText?: string | null,
  buttonUrl?: string | null
): Promise<MetaSendResult> {
  console.log(`🌐 [MetaClient] Initiating Private Reply for comment: ${commentId}`);

  // Fallback: Private replies only support plain text. If button exists, append URL to the body text.
  let cleanMessage = messageText;
  if (buttonText && buttonUrl) {
    cleanMessage += `\n\n👉 ${buttonText} 링크 바로가기:\n${buttonUrl}`;
  }

  if (accessToken.startsWith("mock_access_token") || accessToken.startsWith("access_token_mock")) {
    console.log("🛠️ [MetaClient] Mock Access Token detected. Simulating API Request...");
    console.log(`>> POST https://graph.facebook.com/v20.0/${commentId}/private_replies`);
    console.log(`>> Headers: { Authorization: "Bearer ${accessToken.substring(0, 15)}..." }`);
    console.log(`>> Body: { message: "${cleanMessage.replace(/\n/g, "\\n")}" }`);

    await new Promise((resolve) => setTimeout(resolve, 300));
    
    console.log("✅ [MetaClient] Mock API response: 200 OK");
    return {
      success: true,
      messageId: `mock_reply_mid_${Date.now()}`,
    };
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${commentId}/private_replies`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message: cleanMessage }),
    });

    const data = (await response.json()) as MetaApiResponse;

    if (response.ok && !data.error) {
      return {
        success: true,
        messageId: data.id || `real_reply_mid_${Date.now()}`,
      };
    } else {
      const errorMsg = data.error?.message || "Unknown Meta Graph API Error";
      console.error(`❌ [MetaClient] Graph API private_replies call failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Network request failed";
    console.error("❌ [MetaClient] Network/Fetch error during private reply:", err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Sends a Direct Message to a specific Instagram user ID
 * API Reference: POST /v20.0/me/messages
 */
export async function sendDirectMessage(
  recipientId: string,
  messageText: string,
  accessToken: string,
  buttonText?: string | null,
  buttonUrl?: string | null
): Promise<MetaSendResult> {
  console.log(`🌐 [MetaClient] Initiating Direct Message for recipient: ${recipientId}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let messagePayload: any = { text: messageText };

  // If button details exist, build Instagram Generic Template payload
  if (buttonText && buttonUrl) {
    messagePayload = {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [
            {
              title: "DM Launch",
              subtitle: messageText,
              buttons: [
                {
                  type: "web_url",
                  url: buttonUrl,
                  title: buttonText
                }
              ]
            }
          ]
        }
      }
    };
  }

  if (accessToken.startsWith("mock_access_token") || accessToken.startsWith("access_token_mock")) {
    console.log("🛠️ [MetaClient] Mock Access Token detected. Simulating API Request...");
    console.log(`>> POST https://graph.facebook.com/v20.0/me/messages`);
    console.log(`>> Headers: { Authorization: "Bearer ${accessToken.substring(0, 15)}..." }`);
    console.log(`>> Body: { recipient: { id: "${recipientId}" }, message: ${JSON.stringify(messagePayload)} }`);

    await new Promise((resolve) => setTimeout(resolve, 300));

    console.log("✅ [MetaClient] Mock API response: 200 OK");
    return {
      success: true,
      messageId: `mock_dm_mid_${Date.now()}`,
    };
  }

  try {
    const url = `https://graph.facebook.com/v20.0/me/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: messagePayload,
      }),
    });

    const data = (await response.json()) as MetaApiResponse;

    if (response.ok && !data.error) {
      return {
        success: true,
        messageId: data.message_id || `real_dm_mid_${Date.now()}`,
      };
    } else {
      const errorMsg = data.error?.message || "Unknown Meta Graph API Error";
      console.error(`❌ [MetaClient] Graph API me/messages call failed: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Network request failed";
    console.error("❌ [MetaClient] Network/Fetch error during DM:", err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
