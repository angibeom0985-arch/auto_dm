type User = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
  password: string;
};

type Automation = {
  id: string;
  name: string;
  triggerType: "comment" | "dm";
  trigger: string;
  message: string;
  status: string;
  targetPostId: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  sent: number;
  readCount: number;
  clickCount: number;
  conversion: string;
};

type EventLog = {
  id: string;
  time: string;
  type: string;
  text: string;
  status: "success" | "warning" | "info" | "error";
};

const users: User[] = [
  {
    id: "admin-demo",
    email: "데이비",
    name: "데이비",
    role: "ADMIN",
    password: "12345678",
  },
];

const automations: Automation[] = [];
const events: EventLog[] = [
  {
    id: "evt-ready",
    time: currentTime(),
    type: "system",
    text: "Vercel API route is ready on instagram.gowith153.com.",
    status: "success",
  },
];
const leads: unknown[] = [];
const templates: unknown[] = [];
const queue: unknown[] = [];

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function send(res: any, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function readToken(req: any) {
  const auth = req.headers.authorization || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

function userFromToken(req: any) {
  const token = readToken(req);
  const [, userId] = token.split(":");
  return users.find((user) => user.id === userId) || users[0];
}

function requireAuth(req: any, res: any) {
  if (!readToken(req)) {
    send(res, 401, { error: "Access token is missing" });
    return null;
  }

  return userFromToken(req);
}

export default async function handler(req: any, res: any) {
  const url = new URL(req.url || "/", "https://instagram.gowith153.com");
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method || "GET";
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (path === "/auth/login" && method === "POST") {
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    let user = users.find((item) => item.email === email && item.password === password);

    if (!user && email && password) {
      user = {
        id: id("user"),
        email,
        name: email,
        role: users.length === 0 ? "ADMIN" : "USER",
        password,
      };
      users.push(user);
    }

    if (!user) {
      send(res, 401, { error: "Invalid credentials" });
      return;
    }

    send(res, 200, {
      token: `demo:${user.id}:${Date.now()}`,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    return;
  }

  if (path === "/auth/register" && method === "POST") {
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    const name = String(body.name || email).trim();

    if (!email || !password || !name) {
      send(res, 400, { error: "Email, password, and name are required." });
      return;
    }

    const existing = users.find((user) => user.email === email);
    const user =
      existing ||
      ({
        id: id("user"),
        email,
        name,
        role: users.length === 0 ? "ADMIN" : "USER",
        password,
      } satisfies User);

    if (!existing) users.push(user);

    send(res, 200, {
      token: `demo:${user.id}:${Date.now()}`,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
    return;
  }

  if (path === "/auth/deauthorize" && method === "POST") {
    events.unshift({ id: id("evt"), time: currentTime(), type: "Meta", text: "Meta deauthorization simulated.", status: "warning" });
    send(res, 200, { url: "https://instagram.gowith153.com/api/auth/deletion/status", confirmation_code: id("del") });
    return;
  }

  if (path === "/auth/deletion/status") {
    send(res, 200, { status: "completed" });
    return;
  }

  const user = requireAuth(req, res);
  if (!user) return;

  if (path === "/auth/me") {
    send(res, 200, { id: user.id, email: user.email, name: user.name, role: user.role });
    return;
  }

  if (path === "/automations" && method === "GET") {
    send(res, 200, automations);
    return;
  }

  if (path === "/automations" && method === "POST") {
    const automation: Automation = {
      id: id("auto"),
      name: body.name || "새 자동화",
      triggerType: body.triggerType || "comment",
      trigger: body.trigger || "",
      message: body.message || "",
      status: body.status || "운영중",
      targetPostId: body.targetPostId || null,
      buttonText: body.buttonText || null,
      buttonUrl: body.buttonUrl || null,
      sent: 0,
      readCount: 0,
      clickCount: 0,
      conversion: "0%",
    };
    automations.unshift(automation);
    send(res, 200, automation);
    return;
  }

  const automationMatch = path.match(/^\/automations\/([^/]+)$/);
  if (automationMatch && method === "PUT") {
    const index = automations.findIndex((item) => item.id === automationMatch[1]);
    if (index === -1) {
      send(res, 404, { error: "Automation not found" });
      return;
    }
    automations[index] = { ...automations[index], ...body };
    send(res, 200, automations[index]);
    return;
  }

  if (automationMatch && method === "DELETE") {
    const index = automations.findIndex((item) => item.id === automationMatch[1]);
    if (index >= 0) automations.splice(index, 1);
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/events" && method === "GET") {
    send(res, 200, events);
    return;
  }

  if (path === "/events/clear" && method === "POST") {
    events.length = 0;
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/leads" && method === "GET") {
    send(res, 200, leads);
    return;
  }

  if (path === "/templates" && method === "GET") {
    send(res, 200, templates);
    return;
  }

  if (path === "/templates" && method === "POST") {
    const template = { id: id("tpl"), name: body.name || "템플릿", content: body.content || "", type: body.type || "일반 안내" };
    templates.unshift(template);
    send(res, 200, template);
    return;
  }

  if (path.match(/^\/templates\/([^/]+)$/) && method === "DELETE") {
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/queue" && method === "GET") {
    send(res, 200, queue);
    return;
  }

  if (path === "/queue/clear" && method === "POST") {
    queue.length = 0;
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/simulator" && method === "POST") {
    events.unshift({ id: id("evt"), time: currentTime(), type: body.type || "comment", text: body.text || "테스트 이벤트", status: "info" });
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/settings/meta" && method === "GET") {
    send(res, 200, null);
    return;
  }

  if (path === "/settings/meta" && method === "POST") {
    send(res, 200, { connected: false });
    return;
  }

  if (path.startsWith("/settings/") && method === "POST") {
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/stats/analytics") {
    send(res, 200, []);
    return;
  }

  if (path === "/admin/users") {
    send(res, 200, users.map((item) => ({ id: item.id, email: item.email, name: item.name, role: item.role })));
    return;
  }

  if (path === "/admin/system-logs") {
    send(res, 200, []);
    return;
  }

  send(res, 404, { error: `API route not found: ${method} ${path}` });
}
