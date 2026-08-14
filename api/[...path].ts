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
  messageB?: string | null;
  sentB?: number;
  clickCountB?: number;
  conversionB?: string | null;
  thumbnail?: string | null;
};

type EventLog = {
  id: string;
  time: string;
  type: string;
  text: string;
  status: "success" | "warning" | "info" | "error";
};

const SITE_ORIGIN = "https://insta.money-hotissue.com";

const users: User[] = [
  {
    id: "admin-demo",
    email: "콘자",
    name: "콘자",
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
    text: "Vercel API route is ready on insta.money-hotissue.com.",
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
  const url = new URL(req.url || "/", SITE_ORIGIN);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method || "GET";
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  // Public Click Redirection API (A/B Test Conversion)
  const clickMatch = path.match(/^\/(?:autodm\/)?click\/([^/]+)$/);
  if (clickMatch && method === "GET") {
    const automationId = clickMatch[1];
    const automation = automations.find((item) => item.id === automationId);
    if (!automation) {
      res.statusCode = 302;
      res.setHeader("Location", "https://insta.money-hotissue.com");
      res.end();
      return;
    }
    const variant = (url.searchParams.get("variant") as string) || "A";
    if (variant === "B") {
      automation.clickCountB = (automation.clickCountB || 0) + 1;
      const sentB = automation.sentB || 1;
      automation.conversionB = `${((automation.clickCountB / sentB) * 100).toFixed(1)}%`;
    } else {
      automation.clickCount = (automation.clickCount || 0) + 1;
      const sent = automation.sent || 1;
      automation.conversion = `${((automation.clickCount / sent) * 100).toFixed(1)}%`;
    }
    res.statusCode = 302;
    res.setHeader("Location", automation.buttonUrl || "https://insta.money-hotissue.com");
    res.end();
    return;
  }

  // Public Post Details API (Bypass Auth)
  const publicPostMatch = path.match(/^\/(?:autodm\/)?public\/post\/([^/]+)$/);
  if (publicPostMatch && method === "GET") {
    const automationId = publicPostMatch[1];
    let automation = automations.find((item) => item.id === automationId);
    if (!automation && (automationId === "1" || automationId === "2" || automationId === "3" || automationId === "4" || automationId === "5" || automationId === "11" || automationId === "15" || automationId === "media_post_101" || automationId === "media_post_102")) {
      const fallbackData: Record<string, any> = {
        "1": {
          id: "1",
          name: "바세린에 계란 꼭 섞어보세요",
          message: "비싼 기능성 화장품 없이도 눈가 주름을 쫀쫀하게 만들어주는 피부 좋은 주부들의 천연 바세린 계란 팩 레시피입니다!\n\n[준비물]\n- 계란 노른자 1개\n- 계란 흰자 1스푼\n- 바세린 1스푼\n- 레몬즙 1스푼\n\n[만드는 법]\n1. 그릇에 분리한 노른자와 흰자 1스푼을 넣고 섞어 줍니다\n2. 바세린 1스푼과 레몬즙 1스푼을 추가해 줍니다 (레몬즙이 바세린의 흡수를 강력하게 도와줍니다)\n3. 완성된 팩을 주름 고민 부위에 고르게 바릅니다\n4. 그 위에 비닐 랩을 밀착시켜 15분간 밀봉 흡수시킵니다\n5. 미온수로 부드럽게 닦아내 주면 물광 피부 완성!\n\n아래 버튼을 누르면 안티에이징 팩 도구와 추천 바세린을 최저가에 바로 보실 수 있습니다!",
          buttonText: "천연 팩 도구 최저가 확인하기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_1.png"
        },
        "2": {
          id: "2",
          name: "베개 밑에 마스크 꼭 두세요",
          message: "여름철 모기 진드기 좀벌레를 100% 차단해주는 천연 정향 주머니 제작 가이드입니다!\n\n[준비물]\n- 천연 정향 약 20g\n- 일회용 마스크 1개\n- 가위\n\n[제작 방법]\n1. 마스크 한쪽 끝을 가위로 잘라 주머니 형태의 공간을 확보합니다\n2. 정향을 벌어진 공간에 한 줌 가득 밀어 넣습니다\n3. 잘라낸 마스크 귀 끈을 이용해 입구를 꽁꽁 묶어줍니다\n4. 베개 밑이나 옷장에 던져두면 천연 아로마 방충 주머니 완성!\n\n아래 버튼을 누르면 정향을 최저가에 바로 구매할 수 있는 페이지로 이동합니다!",
          buttonText: "정향 최저가 구매 링크 바로가기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_2.png"
        },
        "3": {
          id: "3",
          name: "식빵에 비누를 꼭 넣어보세요",
          message: "집안 곳곳에 숨어있는 바퀴벌레와 쥐를 싹 없애주는 천연 식빵 비누 퇴치제 레시피입니다!\n\n[준비물]\n- 식빵 1조각\n- 비누 (종류 상관없음)\n- 치약 1큰술\n- 설탕 2큰술\n- 베이킹소다 1큰술\n- 플라스틱 페트병 2개\n\n[만드는 법]\n1. 비누를 강판에 잘게 갈아줍니다\n2. 간 비누에 치약 1큰술, 설탕 2큰술, 베이킹소다 1큰술을 넣고 잘 섞어 페이스트로 만듭니다\n3. 식빵을 작게 찢어 페이스트와 골고루 섞어 뭉쳐줍니다\n4. 페트병 바닥을 잘라 용기로 만든 뒤 완성된 미끼를 담아둡니다\n5. 싱크대 밑, 배수구 근처, 어두운 구석 등 해충이 다니는 길목에 놓아두면 끝!\n\n아래 버튼을 누르면 친환경 벌레퇴치용품을 최저가에 바로 보실 수 있습니다!",
          buttonText: "친환경 퇴치제 구경하러 가기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_3.png"
        },
        "4": {
          id: "4",
          name: "호텔식 변기 천연 세정제 비법",
          message: "호텔에서 화장실 문 열자마자 기분 좋은 향기가 났던 비결 궁금하셨죠?\n매번 청소할 필요 없이 물만 내리면 악취와 물때를 싹 없애주는 호텔식 수제 변기 세정제 레시피입니다!\n\n[준비물]\n- 안 쓰는 남은 비누 1개 (종류 상관없음)\n- 치약 반 통 (약 50g)\n- 베이킹소다 2큰술\n- 알루미늄 호일\n- 이쑤시개 혹은 바늘\n\n[만드는 법]\n1. 안 쓰는 비누를 칼이나 강판으로 잘게 갈아줍니다\n2. 갈아놓은 비누에 치약 반 통과 베이킹소다 2큰술을 넣어줍니다\n3. 가루가 날리지 않게 손으로 꼭꼭 눌러 뭉쳐 반죽을 만듭니다 (밀가루 반죽처럼 부드러워질 때까지 치대어 줍니다)\n4. 반죽을 한 입 크기의 동그란 경단 모양으로 뭉쳐줍니다\n5. 뭉친 반죽을 알루미늄 호일로 꼼꼼하게 감싸 포장해 줍니다\n6. 호일 표면에 이쑤시개나 바늘을 이용해 구멍을 6~8개 정도 뚫어줍니다\n7. 변기 수조(물탱크) 안쪽 구석에 쏙 넣어두면 끝!\n\n구멍 사이로 치약과 비누 성분이 서서히 녹아 나오며 물을 내릴 때마다 자동 세정과 살균 효과가 지속됩니다!\n\n아래 버튼을 누르면 이 레시피에 필요한 가성비 천연 비누와 베이킹소다를 최저가에 바로 보실 수 있습니다!",
          buttonText: "천연 세정제 재료 최저가 확인하기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_4.png"
        },
        "5": {
          id: "5",
          name: "천연 관절 통증 완화 마늘오일 비법",
          message: "비싼 파스나 소화 안 되는 약 없이도 뻐근하고 시큰거리는 무릎, 손목 통증을 싹 가라앉혀주는 고대 천연 마늘 관절 오일 레시피입니다!\n\n[준비물]\n- 마늘 1통 (껍질째 준비)\n- 양파 1개 (껍질째 준비)\n- 생강 약간\n- 엑스트라 버진 올리브 오일\n- 깨끗한 유리병\n- 중탕용 냄비 and 천\n\n[만드는 법]\n1. 마늘과 양파는 영양 성분이 가득한 껍질째 얇게 썰어 줍니다\n2. 생강은 껍질을 벗긴 뒤 얇게 편으로 썰어 준비합니다\n3. 썰어둔 재료들을 유리병에 가득 채우고 재료가 완전히 잠기도록 올리브 오일을 부어 줍니다\n4. 냄비 바닥에 천을 깔고 유리병을 얹은 뒤 물을 채워 줍니다\n5. 약불로 켜서 20분에서 30분 동안 은은하게 중탕하여 유효 성분을 추출합니다\n6. 완성된 오일을 한 김 식힌 뒤 고운 체나 면포로 오일만 걸러냅니다\n7. 통증이 있는 무릎, 손목, 어깨 마디마디에 아침저녁으로 슥슥 마사지하듯 바르세요!\n\n아래 버튼을 누르면 이 레시피에 필요한 가성비 천연 올리브 오일과 병 재료를 최저가에 바로 확인하실 수 있습니다!",
          buttonText: "가성비 오일 및 용기 최저가 확인하기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_5.png"
        },
        "11": {
          id: "11",
          name: "양초에 정향을 꼭 얹어보세요",
          message: "집안 모기와 날벌레 싹 퇴치하고 묵은 잡내까지 없애주는 천연 정향 양초 레시피입니다!\n\n[준비물]\n1. 일반 양초 1개\n2. 통정향 1한 줌\n3. 계핏가루 1스푼\n4. 은박지 약간\n5. 유리 용기\n6. 물 1컵\n\n[만드는 법]\n1. 양초 하단을 은박지로 감싸 유리 용기 중앙에 고정합니다\n2. 용기에 물을 채우고 통정향 한 줌과 계핏가루 1스푼을 넣어 줍니다\n3. 불을 붙이면 천연 방충 성분과 은은한 아로마 향이 집안 구석구석 퍼집니다\n\n아래 버튼을 누르면 인스타그램 계정에서 더 많은 천연 살림 꿀팁을 보실 수 있습니다!",
          buttonText: "더 많은 살림 꿀팁 확인하기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_2.png"
        },
        "15": {
          id: "15",
          name: "양초에 은박지 꼭 감싸보세요",
          message: "일반 양초를 비싼 고급 아로마 양초처럼 3배 더 길게 오래 사용하는 은박지와 물 활용 꿀팁입니다!\n\n[준비물]\n- 은박지 (알루미늄 호일)\n- 물 1컵\n- 유리 용기\n- 사용하던 양초\n\n[만드는 법]\n1. 양초 아랫부분과 바닥을 은박지로 감쌉니다\n2. 은박지로 감싼 양초를 유리 용기 중앙에 세워 고정합니다\n3. 용기 바닥에 물을 1cm 높이로 부어 줍니다\n4. 불을 붙이면 촛농이 흐르지 않고 연소 시간이 3배 이상 늘어납니다\n\n아래 버튼을 누르면 인스타그램 계정에서 더 많은 천연 살림 꿀팁을 보실 수 있습니다!",
          buttonText: "오래 쓰는 법 가이드 확인하기",
          buttonUrl: "https://insta.money-hotissue.com",
          thumbnail: "/images/thumbnail_2.png"
        },
        "media_post_101": {
          id: "media_post_101",
          name: "인스타 3개월만에 1만 팔로워 달성법 가이드북",
          message: "안녕하세요! 요청하신 인스타 3개월만에 1만 팔로워 달성법 비밀 가이드북 다운로드 링크입니다.\n아래 다운로드 버튼을 클릭하여 pdf 전자책을 받아 가세요!",
          buttonText: "비결 가이드북 무료 다운로드",
          buttonUrl: "https://insta.money-hotissue.com"
        },
        "media_post_102": {
          id: "media_post_102",
          name: "디자이너 없이 10분 만에 카드뉴스 만드는 무료 템플릿",
          message: "안녕하세요! 요청하신 디자이너 없이 10분 만에 카드뉴스 만드는 무료 템플릿 50종 다운로드 링크입니다.\n아래 다운로드 버튼을 클릭하여 템플릿 파일을 받아 가세요!",
          buttonText: "무료 템플릿 50종 다운로드",
          buttonUrl: "https://insta.money-hotissue.com"
        }
      };
      automation = fallbackData[automationId];
    }
    if (!automation) {
      send(res, 404, { error: "Automation not found" });
      return;
    }
    send(res, 200, {
      id: automation.id,
      name: automation.name,
      message: automation.message,
      buttonText: automation.buttonText,
      buttonUrl: automation.buttonUrl,
      thumbnail: automation.thumbnail || null
    });
    return;
  }

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

  if (path === "/auth/facebook" && method === "GET") {
    send(res, 200, {
      connected: false,
      message: "Meta OAuth placeholder is served from insta.money-hotissue.com.",
      tokenReceived: Boolean(url.searchParams.get("token")),
    });
    return;
  }

  if (path === "/auth/deauthorize" && method === "POST") {
    events.unshift({ id: id("evt"), time: currentTime(), type: "Meta", text: "Meta deauthorization simulated.", status: "warning" });
    send(res, 200, { url: `${SITE_ORIGIN}/api/auth/deletion/status`, confirmation_code: id("del") });
    return;
  }

  if (path === "/auth/deletion/status") {
    send(res, 200, { status: "completed" });
    return;
  }

  if (path === "/webhook/instagram" && method === "GET") {
    const challenge = url.searchParams.get("hub.challenge");
    send(res, 200, challenge || { ok: true, endpoint: `${SITE_ORIGIN}/api/webhook/instagram` });
    return;
  }

  if (path === "/webhook/instagram" && method === "POST") {
    events.unshift({ id: id("evt"), time: currentTime(), type: "webhook", text: "Instagram webhook event received.", status: "info" });
    send(res, 200, { ok: true });
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
      name: body.name || "New automation",
      triggerType: body.triggerType || "comment",
      trigger: body.trigger || "",
      message: body.message || "",
      status: body.status || "active",
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

  if (path.match(/^\/leads\/([^/]+)$/) && method === "PUT") {
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/templates" && method === "GET") {
    send(res, 200, templates);
    return;
  }

  if (path === "/templates" && method === "POST") {
    const template = { id: id("tpl"), name: body.name || "Template", content: body.content || "", type: body.type || "general" };
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
    events.unshift({ id: id("evt"), time: currentTime(), type: body.type || "comment", text: body.text || "Test event", status: "info" });
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/settings/meta" && method === "GET") {
    send(res, 200, { connected: false, account: null });
    return;
  }

  if (path === "/settings/meta" && method === "POST") {
    send(res, 200, { connected: false, account: null });
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
