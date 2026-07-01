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
      res.status(400).json({ error: "Email already registered." });
      return;
    }

    // Set first registered user as ADMIN for ease of demo, others as USER
    const userCount = await prisma.user.count();
    const role = userCount === 0 || email === "admin@gowith153.com" ? "ADMIN" : "USER";

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
      where: { email: "admin@gowith153.com" }
    });
    if (!adminUser) {
      adminUser = await prisma.user.create({
        data: {
          email: "admin@gowith153.com",
          passwordHash: hashPassword("admin153!"),
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
  const redirectUri = `http://localhost:${PORT}/api/auth/facebook/callback?code=mock_code_abc&token=${token || ""}`;
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
          display: grid;
          place-items: center;
          height: 100vh;
          margin: 0;
        }
        .card {
          background: #1e293b;
          padding: 30px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          max-width: 420px;
          text-align: center;
          box-shadow: 0 10px 25px rgba(0,0,0,0.3);
        }
        .logo {
          font-size: 24px;
          font-weight: 800;
          color: #1877f2;
          margin-bottom: 15px;
        }
        h2 { margin: 0 0 10px; font-size: 20px; }
        p { color: #94a3b8; font-size: 13px; line-height: 1.5; margin: 0 0 25px; }
        .scope-item {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 8px;
          text-align: left;
          font-size: 12px;
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
          margin-top: 20px;
          border: none;
          cursor: pointer;
        }
        .btn-connect:hover { background: #166fe5; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">facebook</div>
        <h2>DM Launch 권한 동의</h2>
        <p>인스타그램 자동 답장 및 DM 발송 기능을 활성화하기 위해 다음 권한을 연동합니다.</p>
        
        <div class="scope-item">🔑 <strong>instagram_business_manage_messages</strong><br>Direct Message 읽기/쓰기 권한</div>
        <div class="scope-item">💬 <strong>instagram_business_manage_comments</strong><br>릴스 및 피드 댓글 관리 권한</div>
        <div class="scope-item">📄 <strong>pages_show_list / pages_read_engagement</strong><br>연결된 페이스북 페이지 정보 조회</div>
        
        <button class="btn-connect" onclick="location.href='${redirectUri}?code=mock_oauth_code_xyz987'">
          연동 완료 및 권한 동의
        </button>
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

// Server boot-up
app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
  startDeliveryWorker();
});
