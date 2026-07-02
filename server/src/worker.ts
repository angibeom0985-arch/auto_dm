import { PrismaClient, QueueItem } from "@prisma/client";
import { sendPrivateReply, sendDirectMessage } from "./metaClient";

const prisma = new PrismaClient();
let intervalId: NodeJS.Timeout | null = null;
let cleanupIntervalId: NodeJS.Timeout | null = null;
let isProcessing = false;

function getFormattedTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/**
 * Sends a webhook notification alert to Slack/Discord/Telegram
 */
export async function sendNotification(url: string, message: string) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message,      // Slack/Teams format
        content: message,   // Discord format
      }),
    });
    if (!response.ok) {
      console.error(`❌ [Notification] Webhook responded with status: ${response.status}`);
    } else {
      console.log("✅ [Notification] Webhook alert dispatched successfully.");
    }
  } catch (err) {
    console.error("❌ [Notification] Failed to send webhook alert:", err);
  }
}

/**
 * Automatically prunes QueueItems and EventLogs older than 90 days
 */
export async function cleanupOldLogs() {
  console.log("🧹 [Worker] Starting database log cleanup (Retention: 90 days)...");
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    // Prune completed queue items older than 90 days
    const prunedQueue = await prisma.queueItem.deleteMany({
      where: {
        status: "COMPLETED",
        createdAt: { lt: cutoff },
      },
    });

    // Prune event logs older than 90 days
    const prunedLogs = await prisma.eventLog.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });

    if (prunedQueue.count > 0 || prunedLogs.count > 0) {
      console.log(`✨ [Worker] Cleanup complete. Removed ${prunedQueue.count} queue items and ${prunedLogs.count} event logs.`);
    } else {
      console.log("✨ [Worker] Cleanup complete. No expired logs found.");
    }
  } catch (error) {
    console.error("❌ [Worker] Cleanup failed:", error);
  }
}

/**
 * Polling function to process PENDING messages in QueueItem database
 */
async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const account = await prisma.account.findFirst();
    if (!account) {
      const pendingItems = await prisma.queueItem.findMany({
        where: { status: "PENDING" },
      });
      if (pendingItems.length > 0) {
        console.log("⚠️ [Worker] Meta account missing. Marking pending queue items as FAILED.");
        const ids = pendingItems.map((item: QueueItem) => item.id);
        await prisma.queueItem.updateMany({
          where: { id: { in: ids } },
          data: { status: "FAILED", errorLog: "Meta 계정이 연동되지 않았습니다. 설정 탭에서 Facebook 로그인을 해주세요." },
        });
        for (const item of pendingItems) {
          await prisma.eventLog.create({
            data: {
              time: getFormattedTime(),
              type: "발송 실패",
              text: `@${item.recipientId} 님 발송 실패: Meta 계정 미연동`,
              status: "error",
              eventId: `reply-fail-${item.id}-noauth`,
            },
          });
        }
      }
      isProcessing = false;
      return;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const completedTodayCount = await prisma.queueItem.count({
      where: {
        status: "COMPLETED",
        createdAt: { gte: todayStart },
      },
    });

    const limit = account.dailyLimit;
    const pendingItems = await prisma.queueItem.findMany({
      where: {
        status: "PENDING",
        retryCount: { lt: 3 },
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    if (pendingItems.length === 0) {
      isProcessing = false;
      return;
    }

    if (completedTodayCount >= limit) {
      console.log(`⚠️ [Worker] Daily limit exceeded (${completedTodayCount}/${limit} sent today). Failing pending queue items.`);
      const ids = pendingItems.map((item: QueueItem) => item.id);
      await prisma.queueItem.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "FAILED",
          errorLog: `일일 발송 한도 초과 (설정된 최대 임계치: ${limit}건)`,
        },
      });

      for (const item of pendingItems) {
        await prisma.eventLog.create({
          data: {
            time: getFormattedTime(),
            type: "발송 실패",
            text: `@${item.recipientId} 님 발송 실패: 일일 발송 제한 한도 초과 (${limit}건)`,
            status: "error",
            eventId: `reply-fail-${item.id}-limit`,
          },
        });
        // Dispatch daily limit exceeded alert
        if (account.notificationUrl) {
          sendNotification(
            account.notificationUrl,
            `⚠️ [한도 초과 경보] @${item.recipientId} 님 발송 실패: 설정된 일일 한도(${limit}건)를 모두 소진하였습니다.`
          );
        }
      }

      isProcessing = false;
      return;
    }

    console.log(`⚙️ [Worker] Found ${pendingItems.length} pending messages to dispatch. (Usage: ${completedTodayCount}/${limit} sent today)`);

    const idsToLock = pendingItems.map((item: QueueItem) => item.id);
    await prisma.queueItem.updateMany({
      where: { id: { in: idsToLock } },
      data: { status: "PROCESSING" },
    });

    for (const item of pendingItems) {
      try {
        const automation = await prisma.automation.findUnique({
          where: { id: item.automationId },
        });

        if (!automation) {
          throw new Error("자동화 규칙이 삭제되었습니다.");
        }

        // ===================================================
        // 24-Hour / 7-Day Messaging Session Guard (고도화 2단계)
        // ===================================================
        const lead = await prisma.lead.findUnique({
          where: { username: item.recipientId },
        });

        if (lead) {
          const timeDiff = Date.now() - new Date(lead.updatedAt).getTime();
          const targetLimitMs =
            automation.triggerType === "dm"
              ? 24 * 60 * 60 * 1000 // 24 Hours for DMs
              : 7 * 24 * 60 * 60 * 1000; // 7 Days for Comment Replies

          if (timeDiff > targetLimitMs) {
            const timeDiffHours = Math.floor(timeDiff / (1000 * 60 * 60));
            const limitText = automation.triggerType === "dm" ? "24시간" : "7일";
            const expiredErrorMsg = `${limitText} 메시징 세션 만료 (마지막 유저 상호작용 후 ${timeDiffHours}시간 경과)`;
            
            console.log(`⚠️ [Guard] Blocking dispatch to @${item.recipientId}. Session expired (${timeDiffHours}h ago > ${limitText}).`);

            // Mark FAILED immediately without retries
            await prisma.queueItem.update({
              where: { id: item.id },
              data: {
                status: "FAILED",
                errorLog: expiredErrorMsg,
              },
            });

            await prisma.eventLog.create({
              data: {
                time: getFormattedTime(),
                type: "발송 실패",
                text: `@${item.recipientId} 님 발송 차단: ${limitText} 메시징 세션 만료 (${timeDiffHours}시간 경과)`,
                status: "error",
                eventId: `reply-fail-${item.id}-guard-expire`,
              },
            });

            // Dispatch Guard Alert to Slack/Discord (고도화 3단계)
            if (account.notificationUrl) {
              sendNotification(
                account.notificationUrl,
                `⚠️ [발송 차단 경보] @${item.recipientId} 님 발송 차단: ${limitText} 세션 만료 (${timeDiffHours}시간 경과)\n- 메시지 본문: "${item.body.substring(0, 30)}..."`
              );
            }

            continue; // Skip Meta API dispatch for this item
          }
        }

        const appUrl = process.env.APP_URL || "https://instagram.gowith153.com";
        const trackingUrl = automation.buttonUrl 
          ? `${appUrl}/api/click/${automation.id}`
          : null;

        let sendResult;

        if (automation.triggerType === "comment") {
          sendResult = await sendPrivateReply(
            item.recipientId,
            item.body,
            account.accessToken,
            automation.buttonText,
            trackingUrl
          );
        } else {
          sendResult = await sendDirectMessage(
            item.recipientId,
            item.body,
            account.accessToken,
            automation.buttonText,
            trackingUrl
          );
        }

        if (sendResult.success) {
          // Increment sent count of automation
          await prisma.automation.update({
            where: { id: automation.id },
            data: { sent: { increment: 1 } }
          });

          await prisma.queueItem.update({
            where: { id: item.id },
            data: { status: "COMPLETED" },
          });

          await prisma.eventLog.create({
            data: {
              time: getFormattedTime(),
              type: "발송 완료",
              text: `@${item.recipientId} 님에게 메시지 발송 완료 (MsgId: ${sendResult.messageId})`,
              status: "success",
              eventId: `reply-sent-${item.id}`,
            },
          });
          console.log(`✅ [Worker] Delivery success for message ID: ${item.id}`);
        } else {
          throw new Error(sendResult.error || "Meta Send API failed");
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error during worker dispatch";
        console.error(`❌ [Worker] Delivery attempt failed for item ID ${item.id}:`, errorMsg);

        const nextRetry = item.retryCount + 1;
        const finalStatus = nextRetry >= 3 ? "FAILED" : "PENDING";

        await prisma.queueItem.update({
          where: { id: item.id },
          data: {
            status: finalStatus,
            retryCount: nextRetry,
            errorLog: errorMsg,
          },
        });

        await prisma.eventLog.create({
          data: {
            time: getFormattedTime(),
            type: finalStatus === "FAILED" ? "발송 실패" : "발송 재시도",
            text: `@${item.recipientId} 님 발송 실패: ${errorMsg.substring(0, 50)}... (${nextRetry}/3회)`,
            status: finalStatus === "FAILED" ? "error" : "warning",
            eventId: `reply-fail-${item.id}-${nextRetry}`,
          },
        });

        // Dispatch Meta Dispatch Failure alert on 3rd FAILED (고도화 3단계)
        if (finalStatus === "FAILED" && account.notificationUrl) {
          sendNotification(
            account.notificationUrl,
            `❌ [발송 최종 실패] @${item.recipientId} 님 최종 발송 실패 (${nextRetry}/3회)\n- 실패 원인: ${errorMsg}\n- 메시지 본문: "${item.body.substring(0, 30)}..."`
          );
        }
      }
    }
  } catch (globalErr) {
    console.error("🔥 [Worker] Global exception in worker loop:", globalErr);
  } finally {
    isProcessing = false;
  }
}

export function startDeliveryWorker() {
  if (intervalId) {
    console.log("ℹ️ [Worker] Delivery worker is already running.");
    return;
  }

  console.log("🚀 [Worker] Starting background delivery worker loop (Interval: 3s)...");
  intervalId = setInterval(processQueue, 3000);

  // Run cleanup once immediately on startup
  cleanupOldLogs();

  // Run cleanup loop every 24 hours (86,400,000 ms)
  console.log("🚀 [Worker] Starting daily database log pruner (Interval: 24h)...");
  cleanupIntervalId = setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
}

export function stopDeliveryWorker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("🛑 [Worker] Background delivery worker loop stopped.");
  }
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    console.log("🛑 [Worker] Background database log pruner stopped.");
  }
}
