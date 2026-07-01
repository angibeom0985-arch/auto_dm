import { PrismaClient, Automation } from "@prisma/client";

const prisma = new PrismaClient();

export interface MatchResult {
  matched: boolean;
  automation: Automation | null;
  matchedKeyword: string;
}

/**
 * Evaluates whether the incoming text matches any active automation trigger.
 * Priority:
 * 1. Reel-specific trigger (targetPostId matches mediaId)
 * 2. Global trigger (targetPostId is null or empty)
 */
export async function evaluateTrigger(
  text: string,
  type: "comment" | "dm",
  mediaId?: string
): Promise<MatchResult> {
  const cleanText = text.trim().toLowerCase();

  try {
    // Fetch only active ('운영중') automations matching the triggerType
    const activeAutomations = await prisma.automation.findMany({
      where: {
        status: "운영중",
        triggerType: type,
      },
    });

    // 1st Pass: Search for specific Reels Match (targetPostId matches mediaId)
    if (type === "comment" && mediaId) {
      const reelSpecificRules = activeAutomations.filter(
        (auto) => auto.targetPostId && auto.targetPostId.trim().toLowerCase() === mediaId.trim().toLowerCase()
      );

      for (const auto of reelSpecificRules) {
        const keywords = auto.trigger.split(",").map((k: string) => k.trim().toLowerCase());
        for (const keyword of keywords) {
          if (cleanText.includes(keyword)) {
            console.log(`🎯 [Engine] Reels-Specific Match Found! MediaId: '${mediaId}', Keyword: '${keyword}' matches Automation: '${auto.name}'`);
            return {
              matched: true,
              automation: auto,
              matchedKeyword: keyword,
            };
          }
        }
      }
    }

    // 2nd Pass: Search for Global Match (targetPostId is empty/null)
    const globalRules = activeAutomations.filter(
      (auto) => !auto.targetPostId || auto.targetPostId.trim() === ""
    );

    for (const auto of globalRules) {
      const keywords = auto.trigger.split(",").map((k: string) => k.trim().toLowerCase());
      for (const keyword of keywords) {
        if (cleanText.includes(keyword)) {
          console.log(`🎯 [Engine] Global Match Found! Keyword: '${keyword}' matches Automation: '${auto.name}'`);
          return {
            matched: true,
            automation: auto,
            matchedKeyword: keyword,
          };
        }
      }
    }
  } catch (error) {
    console.error("Error evaluating trigger in engine:", error);
  }

  return {
    matched: false,
    automation: null,
    matchedKeyword: "",
  };
}

/**
 * Dynamically replaces variables like {{username}} and {{trigger}} in message templates
 */
export function renderTemplate(
  templateText: string,
  variables: { username: string; trigger: string }
): string {
  let rendered = templateText;

  // Replace {{username}}
  rendered = rendered.replace(/\{\{\s*username\s*\}\}/g, variables.username);

  // Replace {{trigger}}
  rendered = rendered.replace(/\{\{\s*trigger\s*\}\}/g, variables.trigger);

  return rendered;
}

/**
 * Inserts a rendering-completed message into the database queue for asynchronous delivery
 */
export async function enqueueMessage(
  recipientId: string,
  automationId: string,
  body: string
): Promise<boolean> {
  try {
    await prisma.queueItem.create({
      data: {
        recipientId,
        automationId,
        body,
        status: "PENDING",
      },
    });
    console.log(`📦 Message enqueued for recipient: @${recipientId} (Status: PENDING)`);
    return true;
  } catch (error) {
    console.error("Error enqueuing message in engine:", error);
    return false;
  }
}
