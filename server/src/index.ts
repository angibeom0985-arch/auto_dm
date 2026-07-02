import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { evaluateTrigger, renderTemplate, enqueueMessage } from "./engine";
import { startDeliveryWorker, sendNotification } from "./worker";

dotenv.config();

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 5000;

// Custom interface for Request with rawBody and Authenticated user
interface AuthRequest extends Request {
  rawBody?: Buffer;
  user?: { userId: string; email: string; role: string };
}

function hashPassword(password: string): string {
  return crypto.createHmac("sha256", "dml_secret_salt_999").update(password).digest("hex");
}

function generateToken(userId: string, email: string, role: string): string {
  const payload = JSON.stringify({ userId, email, role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const signature = crypto.createHmac("sha256", "dml_token_secret").update(payload).digest("hex");
  return Buffer.from(payload).toString("base64") + "." + signature;
}

function verifyToken(token: string): { userId: string; email: string; role: string } | null {
  try {
    const [base64Payload, signature] = token.split(".");
    if (!base64Payload || !signature) return null;
    const payloadStr = Buffer.from(base64Payload, "base64").toString("utf8");
    const expectedSignature = crypto.createHmac("sha256", "dml_token_secret").update(payloadStr).digest("hex");
    if (signature !== expectedSignature) return null;
    const payload = JSON.parse(payloadStr);
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    res.status(401).json({ error: "Access token is missing" });
    return;
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    res.status(403).json({ error: "Access token is invalid or expired" });
    return;
  }
  (req as AuthRequest).user = decoded;
  next();
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));

// Configure express.json to store raw body for signature verification
app.use(
  express.json({
    verify: (req: AuthRequest, res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

// ==========================================
// Auth & Admin Routes (고도화 5단계)
// ==========================================
app.post("/api/auth/register", async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    res.status(400).json({ error: "Email, password, and name are required." });
    return;
  }
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ error: "이미 가입되어 사용 중인 아이디입니다." });
      return;
    }

    // Set first registered user as ADMIN for ease of demo, others as USER
    const userCount = await prisma.user.count();
    const role = userCount === 0 || email === "데이비" ? "ADMIN" : "USER";

    const passwordHash = hashPassword(password);
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role,
      },
    });

    const token = generateToken(newUser.id, newUser.email, newUser.role);
    res.status(201).json({
      success: true,
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    });
  } catch {
    res.status(500).json({ error: "Failed to register user." });
  }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const checkHash = hashPassword(password);
    if (user.passwordHash !== checkHash) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = generateToken(user.id, user.email, user.role);
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch {
    res.status(500).json({ error: "Failed to login." });
  }
});

app.get("/api/auth/me", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: authReq.user.userId },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  } catch {
    res.status(500).json({ error: "Failed to fetch user session" });
  }
});

// Admin: Get all registered SaaS customers and statistics
app.get("/api/admin/users", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user || authReq.user.role !== "ADMIN") {
    res.status(403).json({ error: "Access denied. Admins only." });
    return;
  }
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        automations: true,
        accounts: true,
        leads: true,
      },
    });

    const userStats = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      flowsCount: u.automations.length,
      connectedAccount: u.accounts[0]?.username || "연동 없음",
      leadsCount: u.leads.length,
    }));

    res.json(userStats);
  } catch {
    res.status(500).json({ error: "Failed to fetch admin users statistics" });
  }
});

// Admin: Get all error system logs globally
app.get("/api/admin/system-logs", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  if (!authReq.user || authReq.user.role !== "ADMIN") {
    res.status(403).json({ error: "Access denied. Admins only." });
    return;
  }
  try {
    const errorQueues = await prisma.queueItem.findMany({
      where: {
        status: "FAILED",
      },
      orderBy: { createdAt: "desc" },
      include: {
        user: true,
      },
    });

    const formattedLogs = errorQueues.map((q) => ({
      id: q.id,
      userEmail: q.user?.email || "시스템 공용",
      userName: q.user?.name || "알수없음",
      recipientId: q.recipientId,
      errorLog: q.errorLog || "원인 미상 에러",
      createdAt: q.createdAt,
      body: q.body,
    }));

    res.json(formattedLogs);
  } catch {
    res.status(500).json({ error: "Failed to fetch global system errors" });
  }
});

// Helper to get HH:MM formatted time
function getCurrentTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// HMAC SHA256 Verification Middleware
const verifyMetaSignature = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void => {
  const signature = req.headers["x-hub-signature-256"] as string;

  if (!signature) {
    console.log("⚠️ Webhook Signature Header missing. Bypassing check for development simulation.");
    return next();
  }

  const parts = signature.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    res.status(401).send("Invalid signature format");
    return;
  }

  const expectedSignature = parts[1];
  const appSecret = process.env.META_APP_SECRET || "";

  if (!req.rawBody) {
    res.status(400).send("Request body is empty");
    return;
  }

  const calculatedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(req.rawBody)
    .digest("hex");

  if (expectedSignature !== calculatedSignature) {
    console.error("❌ HMAC Signature Mismatch! Rejecting request.");
    res.status(401).send("Signature mismatch");
    return;
  }

  console.log("✅ HMAC Signature Verified successfully.");
  next();
};

// ==========================================
// DB Initial Seeding Helpers (if tables empty)
// ==========================================
async function seedInitialData() {
  try {
    // Seed default admin user
    let adminUser = await prisma.user.findUnique({
      where: { email: "데이비" }
    });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          email: "데이비",
          passwordHash: hashPassword("7890uiop!"),
          name: "데이비",
          role: "ADMIN",
        }
      });
      console.log("🌱 Default ADMIN user seeded.");
    }
  } catch {
    console.error("❌ Seeding failed");
  }
}

// Initialize seed
seedInitialData();

// ==========================================
// Meta Webhook Integration Endpoints
// ==========================================

// Webhook Verification GET Handshake
app.get("/webhook/instagram", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const localVerifyToken = process.env.META_VERIFY_TOKEN;

  if (mode === "subscribe" && token === localVerifyToken) {
    console.log("🌐 Webhook verification SUCCESS. Sending challenge...");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Webhook verification FAILED. Token mismatch.");
    res.status(403).send("Verification token mismatch");
  }
});

// Webhook Event Receive POST (HMAC Signature Verified)
app.post("/webhook/instagram", verifyMetaSignature, async (req: Request, res: Response) => {
  const body = req.body;

  if (body.object !== "instagram" && body.object !== "page") {
    res.status(404).send("Not an instagram webhook event");
    return;
  }

  const entries = body.entry || [];
  let eventsProcessed = 0;

  // Resolve matching userId from Meta account context (Multi-tenancy)
  const metaAccount = await prisma.account.findFirst();
  const userId = metaAccount ? metaAccount.userId : null;

  try {
    for (const entry of entries) {
      // 1. Process DM events (entry.messaging)
      if (entry.messaging && entry.messaging.length > 0) {
        for (const msgObj of entry.messaging) {
          const messageId = msgObj.message?.mid;
          const text = msgObj.message?.text || "";
          const senderId = msgObj.sender?.id || "unknown_ig_user";

          if (!messageId) continue;

          // Deduplication
          const exists = await prisma.eventLog.findUnique({
            where: { eventId: messageId },
          });

          if (exists) {
            console.log(`⚠️ Ignored duplicate DM event: ${messageId}`);
            continue;
          }

          // Register new event in database
          await prisma.eventLog.create({
            data: {
              eventId: messageId,
              time: getCurrentTime(),
              type: "DM 수신",
              text: `유저 ID [${senderId}] 로부터 DM 수신: "${text}"`,
              status: "info",
              userId,
            },
          });

          // Evaluate Match with active automations in Trigger Engine
          const matchResult = await evaluateTrigger(text, "dm", undefined, userId || undefined);

          if (matchResult.matched && matchResult.automation) {
            // Render template variables
            const renderedMsg = renderTemplate(matchResult.automation.message, {
              username: senderId,
              trigger: matchResult.matchedKeyword,
            });

            // Enqueue message for sending
            await enqueueMessage(senderId, matchResult.automation.id, renderedMsg, userId || undefined);

            // Update stats
            await prisma.automation.update({
              where: { id: matchResult.automation.id },
              data: { sent: { increment: 1 } },
            });

            // Simulated response log (Pending queue)
            await prisma.eventLog.create({
              data: {
                eventId: `reply-dm-${messageId}`,
                time: getCurrentTime(),
                type: "대기열 추가",
                text: `[${senderId}] 님에게 보낼 자동 DM 대기열 등록 완료 (규칙: ${matchResult.automation.name})`,
                status: "success",
                userId,
              },
            });
          }

          eventsProcessed++;
        }
      }

      // 2. Process Comment events (entry.changes)
      if (entry.changes && entry.changes.length > 0) {
        for (const changeObj of entry.changes) {
          if (changeObj.field === "comments") {
            const commentId = changeObj.value?.id;
            const text = changeObj.value?.text || "";
            const username = changeObj.value?.from?.username || "unknown_user";

            if (!commentId) continue;

            // Deduplication
            const exists = await prisma.eventLog.findUnique({
              where: { eventId: commentId },
            });

            if (exists) {
              console.log(`⚠️ Ignored duplicate comment event: ${commentId}`);
              continue;
            }

            // Register new event in database
            await prisma.eventLog.create({
              data: {
                eventId: commentId,
                time: getCurrentTime(),
                type: "댓글 감지",
                text: `@${username} 님의 댓글: "${text}"`,
                status: "info",
                userId,
              },
            });

            const mediaId = changeObj.value?.media?.id || changeObj.value?.media_id;
            // Evaluate Match with active automations in Trigger Engine
            const matchResult = await evaluateTrigger(text, "comment", mediaId, userId || undefined);

            if (matchResult.matched && matchResult.automation) {
              // Render template variables
              const renderedMsg = renderTemplate(matchResult.automation.message, {
                username,
                trigger: matchResult.matchedKeyword,
              });

              // Enqueue message for sending
              await enqueueMessage(username, matchResult.automation.id, renderedMsg, userId || undefined);

              // Update stats
              await prisma.automation.update({
                where: { id: matchResult.automation.id },
                data: { sent: { increment: 1 } },
              });

              // Simulated response log (Pending queue)
              await prisma.eventLog.create({
                data: {
                  eventId: `reply-comment-${commentId}`,
                  time: getCurrentTime(),
                  type: "대기열 추가",
                  text: `@${username} 님에게 보낼 Private Reply 대기열 등록 완료 (규칙: ${matchResult.automation.name})`,
                  status: "success",
                  userId,
                },
              });

              // Sync Lead
              const existingLead = await prisma.lead.findFirst({
                where: { username, userId },
              });

              if (existingLead) {
                await prisma.lead.update({
                  where: { id: existingLead.id },
                  data: {
                    lastActive: "방금 전",
                    messagesCount: { increment: 1 },
                    lastMessage: text,
                  },
                });
              } else {
                await prisma.lead.create({
                  data: {
                    username,
                    lastActive: "방금 전",
                    messagesCount: 1,
                    status: "대기",
                    source: "댓글",
                    lastMessage: text,
                    userId,
                  },
                });
              }
            }

            eventsProcessed++;
          }
        }
      }
    }

    res.json({ success: true, processed: eventsProcessed });
  } catch {
    res.status(500).json({ error: "Failed to process Webhook event" });
  }
});

// ==========================================
// REST API Routes
// ==========================================

// 1. Automations CRUD
app.get("/api/automations", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const automations = await prisma.automation.findMany({
      where: { userId: authReq.user!.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(automations);
  } catch {
    res.status(500).json({ error: "Failed to fetch automations" });
  }
});

app.post("/api/automations", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { name, triggerType, trigger, message, status, targetPostId } = req.body;
  if (!name || !triggerType || !trigger || !message) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  try {
    const newAuto = await prisma.automation.create({
      data: {
        name,
        triggerType,
        trigger,
        message,
        status: status || "운영중",
        targetPostId: targetPostId || null,
        sent: 0,
        conversion: "0.0%",
        userId: authReq.user!.userId,
      },
    });
    res.status(201).json(newAuto);
  } catch {
    res.status(500).json({ error: "Failed to create automation" });
  }
});

app.put("/api/automations/:id", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { id } = req.params;
  const { name, triggerType, trigger, message, status, sent, targetPostId } = req.body;
  try {
    const updated = await prisma.automation.update({
      where: { id, userId: authReq.user!.userId },
      data: {
        name,
        triggerType,
        trigger,
        message,
        status,
        sent,
        targetPostId: targetPostId !== undefined ? targetPostId : undefined,
      },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update automation" });
  }
});

app.delete("/api/automations/:id", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { id } = req.params;
  try {
    await prisma.automation.delete({
      where: { id, userId: authReq.user!.userId },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete automation" });
  }
});

// 2. Leads
app.get("/api/leads", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const leads = await prisma.lead.findMany({
      where: { userId: authReq.user!.userId },
      orderBy: { updatedAt: "desc" },
    });
    res.json(leads);
  } catch {
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

app.put("/api/leads/:id", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { id } = req.params;
  const { status } = req.body;
  try {
    const updated = await prisma.lead.update({
      where: { id, userId: authReq.user!.userId },
      data: { status },
    });
    res.json(updated);
  } catch {
    res.status(500).json({ error: "Failed to update lead status" });
  }
});

// Force expire a lead's last interaction time (for testing 24h guard)
app.post("/api/leads/expire", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { username, offsetHours } = req.body;
  if (!username) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  const hours = typeof offsetHours === "number" ? offsetHours : 25; // default to 25h to exceed 24h limit
  const offsetMs = hours * 60 * 60 * 1000;
  const targetDate = new Date(Date.now() - offsetMs);

  try {
    const existing = await prisma.lead.findFirst({
      where: { username, userId: authReq.user!.userId },
    });

    if (existing) {
      const updated = await prisma.lead.update({
        where: { id: existing.id },
        data: {
          updatedAt: targetDate,
        },
      });
      console.log(`⏱️ [Guard Test] Forced Lead @${username} interaction back by ${hours} hours.`);
      res.json({ success: true, username: updated.username, lastActive: `${hours}시간 전`, updatedAt: updated.updatedAt });
    } else {
      // Create a mock lead in the past
      const newLead = await prisma.lead.create({
        data: {
          username,
          lastActive: `${hours}시간 전`,
          messagesCount: 1,
          status: "대기",
          source: "DM",
          lastMessage: "Forced past seed message",
          updatedAt: targetDate,
          userId: authReq.user!.userId,
        },
      });
      console.log(`⏱️ [Guard Test] Created mock past Lead @${username} (Offset: ${hours} hours).`);
      res.json({ success: true, username: newLead.username, lastActive: `${hours}시간 전`, updatedAt: newLead.updatedAt });
    }
  } catch {
    res.status(500).json({ error: "Failed to force expire lead" });
  }
});

// 3. Templates
app.get("/api/templates", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const templates = await prisma.template.findMany({
      where: { userId: authReq.user!.userId },
      orderBy: { createdAt: "asc" },
    });
    res.json(templates);
  } catch {
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

app.post("/api/templates", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { name, content, type } = req.body;
  try {
    const newTemp = await prisma.template.create({
      data: {
        name,
        content,
        type,
        userId: authReq.user!.userId,
      },
    });
    res.status(201).json(newTemp);
  } catch {
    res.status(500).json({ error: "Failed to create template" });
  }
});

app.delete("/api/templates/:id", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { id } = req.params;
  try {
    await prisma.template.delete({
      where: { id, userId: authReq.user!.userId },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// 4. Events (Log stream)
app.get("/api/events", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const logs = await prisma.eventLog.findMany({
      where: { userId: authReq.user!.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(logs);
  } catch {
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.post("/api/events/clear", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    await prisma.eventLog.deleteMany({
      where: { userId: authReq.user!.userId },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to clear logs" });
  }
});

// 5. Simulator Endpoint (Now triggers engine evaluation and enqueues)
app.post("/api/simulator", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { username, triggerType, text, mediaId } = req.body;
  if (!username || !triggerType || !text) {
    res.status(400).json({ error: "Missing simulation params" });
    return;
  }

  const cleanUser = username.startsWith("@") ? username.slice(1) : username;
  const cleanText = text.trim();
  const userId = authReq.user!.userId;
  
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  try {
    // Evaluate match in Trigger Engine
    const matchResult = await evaluateTrigger(cleanText, triggerType, mediaId, userId);

    if (matchResult.matched && matchResult.automation) {
      const mockEventId = `sim-msg-${Date.now()}`;

      // Render Template variables
      const renderedMsg = renderTemplate(matchResult.automation.message, {
        username: cleanUser,
        trigger: matchResult.matchedKeyword,
      });

      // Enqueue actual candidate message
      await enqueueMessage(cleanUser, matchResult.automation.id, renderedMsg, userId);

      // Log matching success
      await prisma.eventLog.create({
        data: {
          eventId: mockEventId,
          time,
          type: triggerType === "comment" ? "댓글 매칭" : "DM 매칭",
          text: `@${cleanUser} 님의 메시지에 '${matchResult.automation.name}' 규칙 매칭성공 (대기열 등록)`,
          status: "success",
          userId,
        },
      });

      // Update Automation stats
      await prisma.automation.update({
        where: { id: matchResult.automation.id, userId },
        data: { sent: { increment: 1 } },
      });

      // Update or Add Lead
      const existingLead = await prisma.lead.findFirst({
        where: { username: cleanUser, userId },
      });

      if (existingLead) {
        await prisma.lead.update({
          where: { id: existingLead.id },
          data: {
            lastActive: "방금 전",
            messagesCount: { increment: 1 },
            lastMessage: cleanText,
          },
        });
      } else {
        await prisma.lead.create({
          data: {
            username: cleanUser,
            lastActive: "방금 전",
            messagesCount: 1,
            status: "대기",
            source: triggerType === "comment" ? "댓글" : "DM",
            lastMessage: cleanText,
            userId,
          },
        });
      }

      res.json({
        matched: true,
        automationName: matchResult.automation.name,
        message: `매칭 성공! @${cleanUser} 님에게 보낼 메시지가 대기열 큐(Queue)에 등록되었습니다.`,
      });
    } else {
      // Log matching failure
      await prisma.eventLog.create({
        data: {
          time,
          type: triggerType === "comment" ? "댓글 미매칭" : "DM 미매칭",
          text: `@${cleanUser} 님의 입력 '${cleanText}'에 일치하는 활성 키워드가 없습니다.`,
          status: "warning",
          userId,
          eventId: `sim-fail-${Date.now()}`,
        },
      });

      res.json({
        matched: false,
        message: "매칭되는 활성화된 키워드가 없습니다. 자동화 규칙이나 키워드 설정을 확인하세요.",
      });
    }
  } catch {
    res.status(500).json({ error: "Simulation failed internally" });
  }
});

// 6. Meta OAuth Mock Flows
app.get("/api/auth/facebook", (req: Request, res: Response) => {
  const token = req.query.token as string;
  const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>Facebook 로그인 연동 - DM Launch</title>
      <style>
        body {
          background: #0f172a;
          color: #f1f5f9;
          font-family: system-ui, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          box-sizing: border-box;
        }
        .card {
          background: #1e293b;
          padding: 30px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          width: 100%;
          max-width: 440px;
          text-align: center;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        }
        .logo {
          font-size: 24px;
          font-weight: 800;
          color: #1877f2;
          margin-bottom: 15px;
        }
        h2 { margin: 0 0 10px; font-size: 18px; }
        p { color: #94a3b8; font-size: 12px; line-height: 1.5; margin: 0 0 20px; }
        .scope-item {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 8px;
          padding: 8px;
          margin-bottom: 6px;
          text-align: left;
          font-size: 11px;
        }
        .btn-connect {
          display: block;
          width: 100%;
          padding: 12px;
          background: #1877f2;
          color: white;
          text-decoration: none;
          font-weight: 700;
          border-radius: 8px;
          margin-top: 15px;
          border: none;
          cursor: pointer;
          font-size: 13px;
        }
        .btn-connect:hover { background: #166fe5; }
        .form-control {
          display: flex;
          flex-direction: column;
          gap: 4px;
          text-align: left;
          margin-bottom: 12px;
        }
        .form-control label {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 600;
        }
        .form-control input, .form-control textarea {
          padding: 10px;
          background: #0f172a;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 6px;
          color: white;
          font-size: 13px;
        }
        .form-control textarea {
          font-family: monospace;
          resize: none;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">facebook</div>
        <h2>인스타그램 비즈니스 계정 공식 연동</h2>
        <p>서비스 활성화를 위해 Meta Developer API 권한 및 보안 액세스 토큰 정보를 등록합니다.</p>
        
        <div class="scope-item" style="margin-bottom: 20px;">
          🔑 <strong>필수 요구 권한:</strong><br>
          - instagram_business_manage_messages (DM 제어)<br>
          - instagram_business_manage_comments (댓글 감지)
        </div>

        <form action="/api/auth/facebook/manual" method="POST">
          <input type="hidden" name="token" value="${token || ''}">
          <div class="form-control">
            <label>인스타그램 사용자명 (Username)</label>
            <input type="text" name="username" placeholder="예: davey_marketing" required>
          </div>
          <div class="form-control">
            <label>Instagram ID (숫자 식별자)</label>
            <input type="text" name="instagramId" placeholder="예: 17841400000000000" required>
          </div>
          <div class="form-control">
            <label>Meta 액세스 토큰 (Access Token)</label>
            <textarea name="accessToken" rows="4" placeholder="Meta Graph API에서 발급받은 EAAG... 로 시작하는 토큰 입력" required></textarea>
          </div>
          <button type="submit" class="btn-connect" style="background: #10b981; color: #0f172a; margin-top: 20px;">
            인스타그램 계정 연동 완료
          </button>
        </form>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

app.get("/api/auth/facebook/callback", async (req: Request, res: Response) => {
  const { code, token } = req.query;
  if (!code) {
    res.status(400).send("Authorization code missing");
    return;
  }

  const decoded = token ? verifyToken(token as string) : null;
  const userId = decoded ? decoded.userId : null;

  try {
    const expires = new Date();
    expires.setDate(expires.getDate() + 60);

    const account = await prisma.account.upsert({
      where: { instagramId: "ig_dml_studio_12345" },
      update: {
        username: "dml.studio",
        accessToken: `access_token_${code}_${Date.now()}`,
        tokenExpires: expires,
        userId,
      },
      create: {
        instagramId: "ig_dml_studio_12345",
        username: "dml.studio",
        accessToken: `access_token_${code}_${Date.now()}`,
        tokenExpires: expires,
        userId,
      },
    });

    await prisma.eventLog.create({
      data: {
        time: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
        type: "Meta 연결",
        text: "Instagram Professional 계정 'dml.studio' 연동 완료 (토큰 정상)",
        status: "success",
        userId,
        eventId: `meta-connect-${Date.now()}`,
      },
    });

    const htmlResponse = `
      <!DOCTYPE html>
      <html>
      <body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'META_AUTH_SUCCESS', account: ${JSON.stringify(account)} }, '*');
          }
          window.close();
        </script>
        <p>인증 완료! 이 창은 곧 닫힙니다...</p>
      </body>
      </html>
    `;
    res.send(htmlResponse);
  } catch {
    res.status(500).send("Failed to save credentials during callback");
  }
});

app.post("/api/auth/facebook/manual", async (req: Request, res: Response) => {
  const { token, username, instagramId, accessToken } = req.body;
  if (!username || !instagramId || !accessToken) {
    res.status(400).send("Missing required fields");
    return;
  }

  const decoded = token ? verifyToken(token as string) : null;
  const userId = decoded ? decoded.userId : null;

  try {
    const expires = new Date();
    expires.setDate(expires.getDate() + 9999); // 30년 가량 넉넉한 만료기간 부여

    const cleanUsername = username.replace("@", "").trim();

    const account = await prisma.account.upsert({
      where: { instagramId: instagramId.trim() },
      update: {
        username: cleanUsername,
        accessToken: accessToken.trim(),
        tokenExpires: expires,
        userId,
      },
      create: {
        instagramId: instagramId.trim(),
        username: cleanUsername,
        accessToken: accessToken.trim(),
        tokenExpires: expires,
        userId,
      },
    });

    await prisma.eventLog.create({
      data: {
        time: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
        type: "Meta 연결",
        text: `Instagram Professional 실제 계정 '@${cleanUsername}' 연동 완료 (수동 토큰)`,
        status: "success",
        userId,
        eventId: `meta-connect-manual-${Date.now()}`,
      },
    });

    const htmlResponse = `
      <!DOCTYPE html>
      <html>
      <body>
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'META_AUTH_SUCCESS', account: ${JSON.stringify(account)} }, '*');
          }
          window.close();
        </script>
        <p>실제 계정 인증 완료! 이 창은 곧 닫힙니다...</p>
      </body>
      </html>
    `;
    res.send(htmlResponse);
  } catch {
    res.status(500).send("Failed to save manual credentials");
  }
});

app.get("/api/settings/meta", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;
  try {
    const account = await prisma.account.findFirst({
      where: { userId },
    });
    res.json({
      connected: !!account,
      account: account || null,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

app.post("/api/settings/meta", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;
  const { action } = req.body;
  try {
    if (action === "disconnect") {
      await prisma.account.deleteMany({
        where: { userId },
      });
      
      await prisma.eventLog.create({
        data: {
          time: `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`,
          type: "Meta 연결 해제",
          text: "사용자에 의해 Instagram 계정 연동 해제됨",
          status: "warning",
          userId,
          eventId: `meta-disconnect-${Date.now()}`,
        },
      });

      res.json({ connected: false, account: null });
    } else {
      res.status(400).json({ error: "For connection use the /api/auth/facebook endpoint" });
    }
  } catch {
    res.status(500).json({ error: "Failed to disconnect Meta account" });
  }
});

// Update daily limit endpoint
app.post("/api/settings/limit", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;
  const { dailyLimit } = req.body;
  if (typeof dailyLimit !== "number" || dailyLimit < 1) {
    res.status(400).json({ error: "Invalid daily limit value" });
    return;
  }
  try {
    const account = await prisma.account.findFirst({
      where: { userId },
    });
    if (!account) {
      res.status(400).json({ error: "No Meta account connected to set limit" });
      return;
    }
    const updated = await prisma.account.update({
      where: { id: account.id },
      data: { dailyLimit },
    });
    res.json({ success: true, dailyLimit: updated.dailyLimit });
  } catch {
    res.status(500).json({ error: "Failed to update daily limit" });
  }
});

// Meta Data Deletion / Deauthorize callback endpoint (Official Meta spec)
app.post("/api/auth/deauthorize", async (req: Request, res: Response) => {
  console.log("🌐 [Webhook] Received Meta Deauthorize / Data Deletion request.");
  try {
    // 1. Wipe Meta Accounts (Wipe access tokens)
    await prisma.account.deleteMany({});

    // 2. Mask user leads (GDPR Privacy enforcement)
    await prisma.lead.updateMany({
      data: {
        lastMessage: "Data deleted by user request",
        status: "대기",
      },
    });

    // 3. Clear logs
    await prisma.eventLog.create({
      data: {
        time: getCurrentTime(),
        type: "데이터 파기",
        text: "Meta 연동 해제에 따른 개인정보 및 토큰 완전 삭제 완료 (GDPR 규격)",
        status: "warning",
        eventId: `deauth-wipe-${Date.now()}`,
      },
    });

    // Respond with official Meta deletion status check spec
    const APP_URL = process.env.APP_URL || "https://instagram.gowith153.com";
    res.json({
      url: `${APP_URL}/api/auth/deletion/status?id=del_${Date.now()}`,
      confirmation_code: `mock_del_conf_${Date.now()}`,
    });
  } catch {
    res.status(500).json({ error: "Failed to process deauthorization" });
  }
});

// Meta Deletion status query endpoint
app.get("/api/auth/deletion/status", (req: Request, res: Response) => {
  res.json({
    status: "completed",
    message: "Your personal data has been completely erased and leads masked.",
    timestamp: new Date().toISOString(),
  });
});

// Change paywall pricing plan endpoint
app.post("/api/settings/plan", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;
  const { plan } = req.body; // "basic" | "pro"
  if (plan !== "basic" && plan !== "pro") {
    res.status(400).json({ error: "Invalid pricing plan" });
    return;
  }

  const limit = plan === "basic" ? 100 : 1000;

  try {
    const account = await prisma.account.findFirst({
      where: { userId },
    });
    if (!account) {
      res.status(400).json({ error: "Meta 계정 연동 상태가 아닙니다. 먼저 로그인을 완료해주세요." });
      return;
    }

    const updated = await prisma.account.update({
      where: { id: account.id },
      data: { dailyLimit: limit },
    });

    await prisma.eventLog.create({
      data: {
        time: getCurrentTime(),
        type: "플랜 변경",
        text: `서비스 요금 플랜이 '${plan.toUpperCase()}'으로 변경되었습니다 (일일 한도: ${limit}건).`,
        status: "info",
        userId,
        eventId: `plan-change-${Date.now()}`,
      },
    });

    res.json({
      success: true,
      plan,
      dailyLimit: updated.dailyLimit,
    });
  } catch {
    res.status(500).json({ error: "Failed to update subscription plan" });
  }
});

// Update notification URL endpoint
app.post("/api/settings/notification", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user!.userId;
  const { notificationUrl } = req.body;
  try {
    const account = await prisma.account.findFirst({
      where: { userId },
    });
    if (!account) {
      res.status(400).json({ error: "No Meta account connected to configure notification" });
      return;
    }
    const updated = await prisma.account.update({
      where: { id: account.id },
      data: { notificationUrl: notificationUrl || null },
    });
    res.json({ success: true, notificationUrl: updated.notificationUrl });
  } catch {
    res.status(500).json({ error: "Failed to update notification settings" });
  }
});

// Test notification URL endpoint
app.post("/api/settings/notification/test", async (req: Request, res: Response) => {
  const { notificationUrl } = req.body;
  if (!notificationUrl) {
    res.status(400).json({ error: "Notification URL is required for testing" });
    return;
  }
  try {
    await sendNotification(
      notificationUrl,
      `🔔 [DM Launch] 관리자 테스트 알림 발송에 성공했습니다! Slack / Discord Webhook 브릿지가 정상적으로 연동되었습니다.`
    );
    res.json({ success: true, message: "Test notification dispatched." });
  } catch {
    res.status(500).json({ error: "Failed to dispatch test notification" });
  }
});

// GET 7-day stats analytics
app.get("/api/stats/analytics", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);

      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const dateStr = `${mm}/${dd}`;

      const startOfDay = new Date(d);
      startOfDay.setHours(0, 0, 0, 0);

      const endOfDay = new Date(d);
      endOfDay.setHours(23, 59, 59, 999);

      // Count completed sends on this day for current user
      const sentCount = await prisma.queueItem.count({
        where: {
          status: "COMPLETED",
          userId: authReq.user!.userId,
          createdAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      // Count leads converted to "전환완료" on this day for current user
      const convertedCount = await prisma.lead.count({
        where: {
          status: "전환완료",
          userId: authReq.user!.userId,
          updatedAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      // 100% real aggregated metrics from database
      data.push({
        date: dateStr,
        sent: sentCount,
        converted: convertedCount,
      });
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch analytics data" });
  }
});

// 7. Queue Item Monitoring routes
app.get("/api/queue", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    const queue = await prisma.queueItem.findMany({
      where: { userId: authReq.user!.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(queue);
  } catch {
    res.status(500).json({ error: "Failed to fetch message queue" });
  }
});

app.post("/api/queue/clear", authenticateToken, async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  try {
    await prisma.queueItem.deleteMany({
      where: { userId: authReq.user!.userId },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to clear queue" });
  }
});

app.get("/privacy", (req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>개인정보 처리방침 - DM Launch</title>
      <style>
        body { background: #0f172a; color: #cbd5e1; font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
        h1 { color: #f8fafc; border-bottom: 2px solid #334155; padding-bottom: 10px; font-size: 24px; }
        h2 { color: #f1f5f9; margin-top: 30px; font-size: 18px; }
        p, li { font-size: 14px; color: #94a3b8; }
        ul { padding-left: 20px; }
      </style>
    </head>
    <body>
      <h1>개인정보 처리방침 (Privacy Policy)</h1>
      <p>DM Launch(이하 "서비스")는 정보주체의 개인정보를 보호하고 이와 관련한 고충을 신속하고 원활하게 처리할 수 있도록 하기 위하여 다음과 같이 개인정보 처리방침을 수립·공개합니다.</p>
      
      <h2>제1조 (개인정보의 처리 목적)</h2>
      <p>서비스는 다음의 목적을 위하여 개인정보를 처리합니다. 처리하고 있는 개인정보는 다음의 목적 이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.</p>
      <ul>
        <li>회원 가입 및 관리: 회원 식별, 서비스 제공에 따른 본인 인증, 가입 의사 확인, 불량회원의 부정이용 방지</li>
        <li>인스타그램 API 및 자동 DM 발송 서비스 제공: 인스타그램 계정 연동 권한 관리, Webhook 이벤트 수신에 따른 자동 발송 큐 제어 및 발송 결과 로그 보관</li>
      </ul>

      <h2>제2조 (처리하는 개인정보의 항목)</h2>
      <p>서비스는 회원가입 및 서비스 제공을 위해 아래와 같은 개인정보를 수집 및 처리하고 있습니다.</p>
      <ul>
        <li>필수항목: 이름, 로그인 아이디, 비밀번호(암호화 해시 보관)</li>
        <li>연동정보: 인스타그램 Professional 계정명, 인스타그램 ID, Meta API Access Token</li>
      </ul>

      <h2>제3조 (개인정보의 처리 및 보유 기간)</h2>
      <p>회원의 개인정보는 서비스 탈퇴 시까지 보유 및 이용하며, 회원이 계정 연동 해제 또는 회원 탈퇴를 요청하는 경우 지체 없이 해당 정보를 영구 파기합니다.</p>

      <h2>제4조 (개인정보의 파기절차 및 파기방법)</h2>
      <p>서비스는 개인정보 보유기간의 경과, 처리목적 달성 등 개인정보가 불필요하게 되었을 때에는 지체 없이 해당 개인정보를 파기합니다. 전자적 파일 형태의 정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제합니다.</p>

      <h2>제5조 (개인정보의 안전성 확보조치)</h2>
      <p>서비스는 개인정보의 안전성 확보를 위해 비밀번호 해싱 암호화, 데이터베이스 전송 SSL 암호화, 액세스 권한 최소화 등의 안전조치를 취하고 있습니다.</p>
      
      <p style="margin-top: 40px; font-size: 12px; color: #64748b;">시행일자: 2026년 7월 2일</p>
    </body>
    </html>
  `;
  res.send(html);
});

app.get("/terms", (req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>서비스 이용약관 - DM Launch</title>
      <style>
        body { background: #0f172a; color: #cbd5e1; font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
        h1 { color: #f8fafc; border-bottom: 2px solid #334155; padding-bottom: 10px; font-size: 24px; }
        h2 { color: #f1f5f9; margin-top: 30px; font-size: 18px; }
        p, li { font-size: 14px; color: #94a3b8; }
        ul { padding-left: 20px; }
      </style>
    </head>
    <body>
      <h1>서비스 이용약관 (Terms of Service)</h1>
      
      <h2>제1조 (목적)</h2>
      <p>본 약관은 DM Launch(이하 "서비스")가 제공하는 인스타그램 자동 DM 발송 마케팅 솔루션 및 관련 제반 서비스의 이용조건 및 절차에 관한 사항을 규정함을 목적으로 합니다.</p>

      <h2>제2조 (용어의 정의)</h2>
      <p>본 약관에서 사용하는 용어의 정의는 다음과 같습니다.</p>
      <ul>
        <li>"회원"이라 함은 서비스에 접속하여 본 약관에 동의하고 계정을 등록하여 서비스를 이용하는 고객을 말합니다.</li>
        <li>"연동 계정"이라 함은 자동화 발송의 대상이 되는 인스타그램 프로페셔널 계정을 의미합니다.</li>
      </ul>

      <h2>제3조 (이용계약의 성립)</h2>
      <p>이용계약은 회원이 본 약관에 동의하고 가입 신청을 완료한 후, 서비스가 이를 승낙함으로써 성립합니다.</p>

      <h2>제4조 (의무 및 책임 제한)</h2>
      <ul>
        <li>회원은 인스타그램 플랫폼의 정책 및 가이드라인을 준수해야 합니다. 어뷰징 목적의 지나친 DM 발송 행위로 인한 계정 제재 등 불이익에 대해 서비스는 책임을 지지 않습니다.</li>
        <li>서비스는 천재지변, Meta API 정책 급변 또는 플랫폼 기술적 오류 등 불가항력적인 장애에 대해 책임을 면제받습니다.</li>
      </ul>

      <p style="margin-top: 40px; font-size: 12px; color: #64748b;">시행일자: 2026년 7월 2일</p>
    </body>
    </html>
  `;
  res.send(html);
});

app.get("/deletion", (req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>데이터 삭제 지침 - DM Launch</title>
      <style>
        body { background: #0f172a; color: #cbd5e1; font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 40px 20px; }
        h1 { color: #f8fafc; border-bottom: 2px solid #334155; padding-bottom: 10px; font-size: 24px; }
        h2 { color: #f1f5f9; margin-top: 30px; font-size: 18px; }
        p, li { font-size: 14px; color: #94a3b8; }
        ol { padding-left: 20px; }
        .contact { background: #1e293b; padding: 15px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); margin-top: 25px; }
      </style>
    </head>
    <body>
      <h1>데이터 삭제 요청 지침 (Data Deletion Instructions)</h1>
      <p>DM Launch 서비스는 Meta 플랫폼 정책을 전적으로 준수하며, 사용자의 인스타그램 연동 데이터 및 개인정보의 자기결정권을 보장합니다. 당사 서비스를 이용하며 연동된 데이터 및 가입된 계정 정보를 삭제하고자 하는 경우 아래 지침에 따라 주시기 바랍니다.</p>
      
      <h2>방법 1: Facebook 설정에서 자동 연동 해제 및 즉각 삭제</h2>
      <p>페이스북 계정 설정을 통해 본 서비스에 부여된 API 권한을 회수하고 서버에 저장된 데이터를 영구 파기할 수 있습니다.</p>
      <ol>
        <li>연동된 Facebook 프로필의 <strong>[설정 및 개인정보]</strong>로 이동합니다.</li>
        <li>설정 메뉴 내 <strong>[앱 및 웹사이트]</strong> 탭을 클릭합니다.</li>
        <li>목록에서 <strong>[DM Launch]</strong> 서비스를 찾아 선택한 후 <strong>[삭제 (Remove)]</strong> 버튼을 클릭합니다.</li>
        <li>권한 회수와 즉시 당사 백엔드 서버에 데이터 삭제 웹훅(Deauthorize Callback)이 수신되어, 회원님의 액세스 토큰이 완전히 영구 파기되며 수집된 리드 데이터가 마스킹 처리됩니다.</li>
      </ol>

      <h2>방법 2: 고객센터 이메일을 통한 수동 삭제 요청</h2>
      <p>회원가입 계정 자체의 완전 파기 및 데이터 완전 소거를 원하시는 경우 아래 지원 창구를 통해 직접 삭제를 신청하실 수 있습니다.</p>
      <div class="contact">
        <p style="margin: 0; font-weight: bold; color: #f8fafc;">DM Launch 고객 지원팀</p>
        <p style="margin: 5px 0 0; font-size: 13px;">📧 이메일: <a href="mailto:help@gowith153.com" style="color: #10b981;">help@gowith153.com</a></p>
        <p style="margin: 5px 0 0; font-size: 13px;">* 신청 접수 즉시 24시간 내 모든 DB 레코드 및 개인 식별 정보가 영구 격리 후 삭제됩니다.</p>
      </div>

      <p style="margin-top: 40px; font-size: 12px; color: #64748b;">시행일자: 2026년 7월 2일</p>
    </body>
    </html>
  `;
  res.send(html);
});

// Server boot-up
app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  startDeliveryWorker();
});
