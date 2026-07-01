import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Bell,
  Camera,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Cog,
  FileText,
  KeyRound,
  MessageSquareText,
  MousePointerClick,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Users,
  Workflow,
  Trash2,
  RefreshCw,
  Check,
  User,
  ExternalLink,
  Sliders,
} from "lucide-react";

// Interfaces
interface Automation {
  id: string;
  name: string;
  triggerType: "comment" | "dm";
  trigger: string;
  message: string;
  status: "운영중" | "예약" | "점검";
  targetPostId: string | null;
  sent: number;
  conversion: string;
}

interface EventLog {
  id: string;
  time: string;
  type: string;
  text: string;
  status: "success" | "warning" | "info" | "error";
}

interface Lead {
  id: string;
  username: string;
  lastActive: string;
  messagesCount: number;
  status: "대기" | "상담중" | "전환완료";
  source: "댓글" | "DM";
  lastMessage: string;
}

interface Template {
  id: string;
  name: string;
  content: string;
  type: string;
}

interface MetaAccount {
  id: string;
  instagramId: string;
  username: string;
  accessToken: string;
  tokenExpires: string | null;
  dailyLimit: number;
  notificationUrl: string | null;
}

interface QueueItem {
  id: string;
  recipientId: string;
  automationId: string;
  body: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  retryCount: number;
  errorLog: string | null;
  createdAt: string;
}

interface AnalyticsItem {
  date: string;
  sent: number;
  converted: number;
}

const API_BASE = "http://localhost:5000/api";

function App() {
  // Tab State
  const [activeTab, setActiveTab] = useState<"dashboard" | "automations" | "leads" | "templates" | "settings">("dashboard");

  // Domain State (API Integrated)
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [events, setEvents] = useState<EventLog[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsItem[]>([]);

  // Meta Integration State
  const [metaConnected, setMetaConnected] = useState<boolean>(false);
  const [metaLoading, setMetaLoading] = useState<boolean>(false);
  const [metaAccount, setMetaAccount] = useState<MetaAccount | null>(null);

  const [webhookUrl, setWebhookUrl] = useState<string>("https://instagram.gowith153.com/webhook/instagram");
  const [webhookToken, setWebhookToken] = useState<string>("dml_secret_verify_token_12345");
  const [webhookVerified, setWebhookVerified] = useState<boolean>(true);

  // Settings inputs
  const [dailyLimitInput, setDailyLimitInput] = useState<number>(150);
  const [currentPlan, setCurrentPlan] = useState<"basic" | "pro">("basic");
  const [notificationUrlInput, setNotificationUrlInput] = useState<string>("");

  // Builder Input State
  const [newAuto, setNewAuto] = useState<Omit<Automation, "id" | "sent" | "conversion">>({
    name: "",
    triggerType: "comment",
    trigger: "",
    message: "",
    status: "운영중",
    targetPostId: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  // Simulator Input State
  const [simulatorUser, setSimulatorUser] = useState<string>("@creator_life");
  const [simulatorType, setSimulatorType] = useState<"comment" | "dm">("comment");
  const [simulatorText, setSimulatorText] = useState<string>("");
  const [simulatorMediaId, setSimulatorMediaId] = useState<string>("");
  const [simAlert, setSimAlert] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Template Input State
  const [newTemp, setNewTemp] = useState({ name: "", content: "", type: "일반 안내" });

  // Interactive Chart State
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // ==========================================
  // API Fetching Functions
  // ==========================================
  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/automations`);
      if (res.ok) {
        const data = await res.json();
        setAutomations(data);
      }
    } catch (err) {
      console.error("Error fetching automations", err);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/events`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (err) {
      console.error("Error fetching events", err);
    }
  }, []);

  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/leads`);
      if (res.ok) {
        const data = await res.json();
        setLeads(data);
      }
    } catch (err) {
      console.error("Error fetching leads", err);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error("Error fetching templates", err);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/queue`);
      if (res.ok) {
        const data = await res.json();
        setQueue(data);
      }
    } catch (err) {
      console.error("Error fetching queue", err);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stats/analytics`);
      if (res.ok) {
        const data = await res.json();
        setAnalyticsData(data);
      }
    } catch (err) {
      console.error("Error fetching analytics data", err);
    }
  }, []);

  const fetchMetaStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/meta`);
      if (res.ok) {
        const data = await res.json();
        setMetaConnected(data.connected);
        setMetaAccount(data.account);
        if (data.account) {
          setDailyLimitInput(data.account.dailyLimit);
          setNotificationUrlInput(data.account.notificationUrl || "");
          const planName = data.account.dailyLimit <= 100 ? "basic" : "pro";
          setCurrentPlan(planName);
        }
      }
    } catch (err) {
      console.error("Error fetching Meta status", err);
    }
  }, []);

  const refetchAll = useCallback(() => {
    fetchAutomations();
    fetchEvents();
    fetchLeads();
    fetchTemplates();
    fetchQueue();
    fetchAnalytics();
    fetchMetaStatus();
  }, [fetchAutomations, fetchEvents, fetchLeads, fetchTemplates, fetchQueue, fetchAnalytics, fetchMetaStatus]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refetchAll();
  }, [refetchAll]);

  // Realtime Polling (3s interval)
  useEffect(() => {
    const timer = setInterval(() => {
      fetchQueue();
      fetchEvents();
      fetchAutomations();
      fetchAnalytics();
    }, 3000);
    return () => clearInterval(timer);
  }, [fetchQueue, fetchEvents, fetchAutomations, fetchAnalytics]);

  // Recalculate stats based on fetched data
  const stats = useMemo(() => {
    const totalSent = automations.reduce((sum, item) => sum + item.sent, 0);
    const converted = leads.filter((l) => l.status === "전환완료").length;
    const pending = queue.filter((q) => q.status === "PENDING" || q.status === "PROCESSING").length;
    const responseCount = leads.filter((l) => l.messagesCount > 1).length;
    const rate = leads.length > 0 ? (responseCount / leads.length) * 100 : 0;

    return {
      sentToday: totalSent,
      convertedLeads: converted,
      pendingCount: pending,
      responseRate: parseFloat(rate.toFixed(1)),
    };
  }, [automations, leads, queue]);

  // OAuth window message listener
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "META_AUTH_SUCCESS") {
        setMetaConnected(true);
        setMetaAccount(event.data.account);
        if (event.data.account) {
          setDailyLimitInput(event.data.account.dailyLimit);
          setNotificationUrlInput(event.data.account.notificationUrl || "");
          const planName = event.data.account.dailyLimit <= 100 ? "basic" : "pro";
          setCurrentPlan(planName);
        }
        fetchEvents();
        setMetaLoading(false);
      }
    };

    window.addEventListener("message", handleOAuthMessage);
    return () => window.removeEventListener("message", handleOAuthMessage);
  }, [fetchEvents]);

  // 1. Simulator Handle Trigger
  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulatorText.trim()) return;

    try {
      const res = await fetch(`${API_BASE}/simulator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: simulatorUser,
          triggerType: simulatorType,
          text: simulatorText,
          mediaId: simulatorType === "comment" ? simulatorMediaId : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSimAlert({
          message: data.message,
          type: data.matched ? "success" : "error",
        });

        // Instantly reload
        setTimeout(() => {
          fetchEvents();
          fetchAutomations();
          fetchLeads();
          fetchQueue();
          fetchAnalytics();
        }, 500);
      }
    } catch (err) {
      console.error("Simulator request failed", err);
      setSimAlert({ message: "시뮬레이터 요청 중 서버 오류가 발생했습니다.", type: "error" });
    }

    setSimulatorText("");
    setSimulatorMediaId("");
    setTimeout(() => setSimAlert(null), 4000);
  };

  // 2. Automations CRUD
  const handleSaveAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAuto.name || !newAuto.trigger || !newAuto.message) {
      alert("모든 필드를 입력해주세요.");
      return;
    }

    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId ? `${API_BASE}/automations/${editingId}` : `${API_BASE}/automations`;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newAuto),
      });

      if (res.ok) {
        fetchAutomations();
        setEditingId(null);
        setNewAuto({
          name: "",
          triggerType: "comment",
          trigger: "",
          message: "",
          status: "운영중",
          targetPostId: "",
        });
      }
    } catch (err) {
      console.error("Failed to save automation", err);
    }
  };

  const handleEdit = (auto: Automation) => {
    setEditingId(auto.id);
    setNewAuto({
      name: auto.name,
      triggerType: auto.triggerType,
      trigger: auto.trigger,
      message: auto.message,
      status: auto.status,
      targetPostId: auto.targetPostId || "",
    });
  };

  const handleDeleteAutomation = async (id: string) => {
    if (confirm("정말 이 자동화를 삭제하시겠습니까?")) {
      try {
        const res = await fetch(`${API_BASE}/automations/${id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          fetchAutomations();
          if (editingId === id) {
            setEditingId(null);
            setNewAuto({ name: "", triggerType: "comment", trigger: "", message: "", status: "운영중", targetPostId: "" });
          }
        }
      } catch (err) {
        console.error("Failed to delete automation", err);
      }
    }
  };

  const handleToggleStatus = async (id: string) => {
    const auto = automations.find((a) => a.id === id);
    if (!auto) return;

    const nextStatus: Automation["status"] =
      auto.status === "운영중" ? "점검" : "운영중";

    try {
      const res = await fetch(`${API_BASE}/automations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...auto, status: nextStatus }),
      });
      if (res.ok) {
        fetchAutomations();
      }
    } catch (err) {
      console.error("Failed to toggle status", err);
    }
  };

  // 3. Templates CRUD
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemp.name || !newTemp.content) return;

    try {
      const res = await fetch(`${API_BASE}/templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newTemp),
      });
      if (res.ok) {
        fetchTemplates();
        setNewTemp({ name: "", content: "", type: "일반 안내" });
      }
    } catch (err) {
      console.error("Failed to create template", err);
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/templates/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchTemplates();
      }
    } catch (err) {
      console.error("Failed to delete template", err);
    }
  };

  const handleApplyTemplate = (temp: Template) => {
    setNewAuto((prev) => ({
      ...prev,
      message: temp.content,
    }));
    setActiveTab("automations");
  };

  // 4. Meta OAuth Connect
  const handleConnectMeta = () => {
    setMetaLoading(true);
    const width = 450;
    const height = 550;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    window.open(
      "http://localhost:5000/api/auth/facebook",
      "facebook-oauth-mock",
      `width=${width},height=${height},top=${top},left=${left},scrollbars=no,resizable=no`
    );
  };

  const handleDisconnectMeta = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      if (res.ok) {
          setMetaConnected(false);
          setMetaAccount(null);
          fetchEvents();
        }
    } catch (err) {
      console.error("Failed to disconnect", err);
    }
  };

  // 5. Update Daily limit
  const handleUpdateDailyLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/settings/limit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dailyLimit: Number(dailyLimitInput) }),
      });
      if (res.ok) {
        alert(`일일 발송 제한량이 ${dailyLimitInput}건으로 저장되었습니다.`);
        fetchMetaStatus();
      } else {
        const data = await res.json();
        alert(data.error || "수정에 실패했습니다.");
      }
    } catch (err) {
      console.error("Failed to update daily limit", err);
    }
  };

  // 6. Update subscription plan
  const handleUpdatePlan = async (selectedPlan: "basic" | "pro") => {
    try {
      const res = await fetch(`${API_BASE}/settings/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      if (res.ok) {
        setCurrentPlan(selectedPlan);
        alert(`구독 요금 플랜이 [${selectedPlan.toUpperCase()}] 플랜으로 변경 연동되었습니다.`);
        refetchAll();
      } else {
        const data = await res.json();
        alert(data.error || "플랜 변경에 실패했습니다.");
      }
    } catch (err) {
      console.error("Failed to update plan", err);
    }
  };

  // 7. Update Notification URL settings
  const handleSaveNotificationUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/settings/notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationUrl: notificationUrlInput }),
      });
      if (res.ok) {
        alert("관리자 Webhook 알림 주소가 성공적으로 저장되었습니다.");
        fetchMetaStatus();
      } else {
        const data = await res.json();
        alert(data.error || "알림 주소 저장에 실패했습니다.");
      }
    } catch (err) {
      console.error("Failed to save notification URL", err);
    }
  };

  const handleTestNotification = async () => {
    if (!notificationUrlInput.trim()) {
      alert("먼저 Webhook 알림 URL을 입력해 주세요.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/settings/notification/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationUrl: notificationUrlInput }),
      });
      if (res.ok) {
        alert("모의 테스트 알림이 발송되었습니다. 수신 채널을 확인해 보세요!");
      } else {
        const data = await res.json();
        alert(data.error || "테스트 알림 발송에 실패했습니다.");
      }
    } catch (err) {
      console.error("Failed to test notification URL", err);
    }
  };

  // 8. Simulates Meta Deauthorization
  const handleSimulateDeauthorize = async () => {
    if (confirm("정말 개인정보 완전 삭제(Meta 연동 해제) 시뮬레이션을 실행하시겠습니까?\n이 작업은 데이터베이스의 모든 Meta 토큰을 파기하고 유치된 리드 식별정보를 GDPR 규격에 맞춰 마스킹 처리합니다.")) {
      try {
        const res = await fetch(`${API_BASE}/auth/deauthorize`, {
          method: "POST",
        });
        if (res.ok) {
          const data = await res.json();
          alert(`Meta 규격 GDPR 개인정보 삭제가 완료되었습니다.\nConfirmation Code: ${data.confirmation_code}\nStatus URL: ${data.url}`);
          refetchAll();
        }
      } catch (err) {
        console.error("Deauthorization failed", err);
      }
    }
  };

  // 9. Webhook Settings Save
  const handleSaveWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    setWebhookVerified(false);
    setTimeout(() => {
      setWebhookVerified(true);
      fetchEvents();
    }, 1000);
  };



  // Lead status changes
  const handleLeadStatusChange = async (leadId: string, nextStatus: Lead["status"]) => {
    try {
      const res = await fetch(`${API_BASE}/leads/${leadId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        fetchLeads();
      }
    } catch (err) {
      console.error("Failed to update lead status", err);
    }
  };

  const getQueueBadgeClass = (status: QueueItem["status"]) => {
    switch (status) {
      case "COMPLETED":
        return "live";
      case "PROCESSING":
        return "scheduled";
      case "PENDING":
        return "pending-badge";
      case "FAILED":
        return "paused";
      default:
        return "";
    }
  };

  // SVG Chart Helper calculations (고도화 4단계)
  const chartCoordinates = useMemo(() => {
    if (analyticsData.length === 0) return { sentPath: "", convertedPath: "", points: [] };

    const maxVal = Math.max(...analyticsData.map((d) => Math.max(d.sent, d.converted * 5, 200)));
    const width = 600;
    const height = 150;
    const paddingLeft = 50;
    const paddingTop = 20;

    const points = analyticsData.map((d, idx) => {
      const x = paddingLeft + idx * (width / (analyticsData.length - 1));
      // Map sent: 0 ~ maxVal -> height ~ 0
      const ySent = paddingTop + height - (d.sent / maxVal) * height;
      // Map converted (scaled * 4 for visual stack consistency) -> height ~ 0
      const yConverted = paddingTop + height - ((d.converted * 4.5) / maxVal) * height;

      return { x, ySent, yConverted, raw: d };
    });

    // Make svg path strings
    const sentLine = points.map((p) => `${p.x},${p.ySent}`).join(" ");
    const convertedLine = points.map((p) => `${p.x},${p.yConverted}`).join(" ");

    const sentArea = `${paddingLeft},${paddingTop + height} ${sentLine} ${paddingLeft + width},${paddingTop + height}`;
    const convertedArea = `${paddingLeft},${paddingTop + height} ${convertedLine} ${paddingLeft + width},${paddingTop + height}`;

    return {
      sentLine,
      convertedLine,
      sentArea,
      convertedArea,
      points,
    };
  }, [analyticsData]);



  return (
    <main className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Camera size={22} />
          </div>
          <div>
            <strong>DM Launch</strong>
            <span>Automation Console</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="주요 메뉴">
          <button
            className={`nav-item ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            <BarChart3 size={18} /> 대시보드
          </button>
          <button
            className={`nav-item ${activeTab === "automations" ? "active" : ""}`}
            onClick={() => setActiveTab("automations")}
          >
            <Workflow size={18} /> 자동화 플로우
          </button>
          <button
            className={`nav-item ${activeTab === "leads" ? "active" : ""}`}
            onClick={() => setActiveTab("leads")}
          >
            <Users size={18} /> 리드 관리
          </button>
          <button
            className={`nav-item ${activeTab === "templates" ? "active" : ""}`}
            onClick={() => setActiveTab("templates")}
          >
            <FileText size={18} /> 메시지 템플릿
          </button>
          <button
            className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Cog size={18} /> 연결 및 설정
          </button>
        </nav>

        <section className="connect-panel">
          <div className="connect-icon">
            <ShieldCheck size={20} />
          </div>
          <strong>Meta 검수 상태</strong>
          <p>공식 API 연동 및 샌드박스 Webhook 연결 상태입니다.</p>
          <button
            onClick={() => setActiveTab("settings")}
            className={metaConnected ? "connected-btn" : "connect-btn"}
          >
            <KeyRound size={16} /> {metaConnected ? "연동 관리" : "Meta 로그인 연결"}
          </button>
        </section>
      </aside>

      {/* Workspace */}
      <section className="workspace">
        {/* Topbar */}
        <header className="topbar">
          <div>
            <p className="eyebrow">Instagram DM Automation</p>
            <h1>
              {activeTab === "dashboard" && "자동 DM 운영 콘솔"}
              {activeTab === "automations" && "자동화 규칙 관리"}
              {activeTab === "leads" && "연결된 리드 관리"}
              {activeTab === "templates" && "메시지 템플릿 관리"}
              {activeTab === "settings" && "서비스 연결 및 API 설정"}
            </h1>
          </div>
          <div className="top-actions">
            <label className="search">
              <Search size={17} />
              <input placeholder="자동화, 리드, 이벤트 검색" />
            </label>
            <button className="icon-button" aria-label="알림">
              <Bell size={19} />
            </button>
            <button
              className="primary-button"
              onClick={() => {
                setActiveTab("automations");
                setEditingId(null);
                setNewAuto({ name: "", triggerType: "comment", trigger: "", message: "", status: "운영중", targetPostId: "" });
              }}
            >
              <Plus size={18} /> 새 자동화 추가
            </button>
          </div>
        </header>



        {/* Tab View: Dashboard */}
        {activeTab === "dashboard" && (
          <>
            {/* Metric Grid */}
            <section className="metric-grid" aria-label="핵심 지표">
              <Metric icon={<Send size={20} />} label="오늘 발송" value={stats.sentToday.toLocaleString()} trend="+12.8% 실시간" />
              <Metric icon={<MousePointerClick size={20} />} label="응답률" value={`${stats.responseRate}%`} trend="+4.2% 이번주" />
              <Metric icon={<CalendarClock size={20} />} label="예약 대기" value={String(stats.pendingCount)} trend="3개 플로우" />
              <Metric icon={<CircleDollarSign size={20} />} label="전환 리드" value={String(stats.convertedLeads)} trend="₩4.8M 예상" />
            </section>

            {/* Neon SVG Analytics Chart Area (고도화 4단계) */}
            <section className="chart-panel animate-fade-in" style={{ background: "var(--surface-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "20px", marginBottom: "25px" }}>
              <div className="section-header" style={{ marginBottom: "15px" }}>
                <div>
                  <p className="eyebrow">Visual Performance Analytics</p>
                  <h2 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <Activity size={20} style={{ color: "var(--accent-emerald)" }} />
                    발송 및 전환 성과 분석 (최근 7일)
                  </h2>
                </div>
                <div style={{ display: "flex", gap: "15px", fontSize: "13px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "var(--accent-emerald)" }}></span>
                    <span style={{ color: "var(--text-secondary)" }}>자동 발송수</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "50%", background: "#38bdf8" }}></span>
                    <span style={{ color: "var(--text-secondary)" }}>리드 전환완료</span>
                  </div>
                </div>
              </div>

              {analyticsData.length === 0 ? (
                <div className="empty-state" style={{ padding: "40px" }}>
                  <RefreshCw className="animate-spin" size={24} />
                  <p>실시간 분석 데이터를 가공 중입니다...</p>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <svg viewBox="0 0 700 210" style={{ width: "100%", height: "auto", overflow: "visible" }} aria-label="발송 및 전환 통계 차트">
                    <defs>
                      <linearGradient id="area-sent" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-emerald)" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="var(--accent-emerald)" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="area-converted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    {/* Horizontal Grid lines */}
                    <line x1="50" y1="20" x2="650" y2="20" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
                    <line x1="50" y1="70" x2="650" y2="70" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
                    <line x1="50" y1="120" x2="650" y2="120" stroke="rgba(255,255,255,0.04)" strokeDasharray="3 3" />
                    <line x1="50" y1="170" x2="650" y2="170" stroke="rgba(255,255,255,0.08)" />

                    {/* Gradient Fills */}
                    {chartCoordinates.sentArea && (
                      <polygon points={chartCoordinates.sentArea} fill="url(#area-sent)" />
                    )}
                    {chartCoordinates.convertedArea && (
                      <polygon points={chartCoordinates.convertedArea} fill="url(#area-converted)" />
                    )}

                    {/* Lines */}
                    {chartCoordinates.sentLine && (
                      <polyline
                        fill="none"
                        stroke="var(--accent-emerald)"
                        strokeWidth="3.5"
                        points={chartCoordinates.sentLine}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ filter: "drop-shadow(0px 2px 8px rgba(16,185,129,0.3))" }}
                      />
                    )}
                    {chartCoordinates.convertedLine && (
                      <polyline
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3.5"
                        points={chartCoordinates.convertedLine}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ filter: "drop-shadow(0px 2px 8px rgba(56,189,248,0.3))" }}
                      />
                    )}

                    {/* Hover Hotspot rects */}
                    {chartCoordinates.points.map((p, idx) => (
                      <g key={idx}>
                        {/* Sent Point dots */}
                        <circle cx={p.x} cy={p.ySent} r={hoveredIndex === idx ? 6 : 4} fill="var(--bg-dark)" stroke="var(--accent-emerald)" strokeWidth="2.5" />
                        {/* Converted Point dots */}
                        <circle cx={p.x} cy={p.yConverted} r={hoveredIndex === idx ? 6 : 4} fill="var(--bg-dark)" stroke="#38bdf8" strokeWidth="2.5" />

                        {/* Date label */}
                        <text x={p.x} y="195" fill="var(--text-muted)" fontSize="11" textAnchor="middle">
                          {p.raw.date}
                        </text>

                        {/* Invisible hover zone */}
                        <rect
                          x={p.x - 20}
                          y="15"
                          width="40"
                          height="160"
                          fill="transparent"
                          style={{ cursor: "pointer" }}
                          onMouseEnter={() => setHoveredIndex(idx)}
                          onMouseLeave={() => setHoveredIndex(null)}
                        />
                      </g>
                    ))}
                  </svg>

                  {/* Absolute positioning tooltip on Hover */}
                  {hoveredIndex !== null && chartCoordinates.points[hoveredIndex] && (
                    <div
                      className="animate-fade-in"
                      style={{
                        position: "absolute",
                        left: `${(chartCoordinates.points[hoveredIndex].x / 700) * 100}%`,
                        top: `${(chartCoordinates.points[hoveredIndex].ySent / 210) * 100 - 30}%`,
                        transform: "translate(-50%, -100%)",
                        background: "rgba(10, 15, 15, 0.95)",
                        border: "1px solid var(--border-color)",
                        borderRadius: "8px",
                        padding: "10px 14px",
                        pointerEvents: "none",
                        zIndex: 10,
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 10px var(--accent-emerald-glow)",
                        backdropFilter: "blur(4px)",
                        minWidth: "150px"
                      }}
                    >
                      <strong style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>
                        일자: {chartCoordinates.points[hoveredIndex].raw.date}
                      </strong>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "13px", color: "var(--text-primary)" }}>
                        <span>DM 발송:</span>
                        <strong style={{ color: "var(--accent-emerald)" }}>{chartCoordinates.points[hoveredIndex].raw.sent}건</strong>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", fontSize: "13px", color: "var(--text-primary)", marginTop: "3px" }}>
                        <span>리드 전환:</span>
                        <strong style={{ color: "#38bdf8" }}>{chartCoordinates.points[hoveredIndex].raw.converted}명</strong>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Middle Grid */}
            <section className="content-grid">
              {/* Automation Quick View */}
              <div className="automation-panel">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Active Flows</p>
                    <h2>자동화 플로우 현황</h2>
                  </div>
                  <button className="ghost-button" onClick={() => setActiveTab("automations")}>
                    자세히 보기 <ExternalLink size={14} />
                  </button>
                </div>

                <div className="table">
                  <div className="table-row table-head">
                    <span>이름 / 전송 메시지</span>
                    <span>트리거 조건</span>
                    <span>발송량</span>
                    <span>상태 ON/OFF</span>
                  </div>
                  {automations.map((automation) => (
                    <div className="table-row" key={automation.id}>
                      <div className="flow-title">
                        <MessageSquareText size={18} />
                        <div>
                          <strong style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {automation.name}
                            {automation.targetPostId && (
                              <span className="template-badge" style={{ fontSize: "10px", padding: "2px 6px" }}>
                                릴스: {automation.targetPostId}
                              </span>
                            )}
                          </strong>
                          <small className="truncate-text">{automation.message}</small>
                        </div>
                      </div>
                      <span>
                        <span className={`trigger-tag ${automation.triggerType}`}>
                          {automation.triggerType === "comment" ? "댓글" : "DM"}
                        </span>{" "}
                        {automation.trigger}
                      </span>
                      <span>{automation.sent.toLocaleString()}</span>
                      <span>
                        <label className="switch-toggle">
                          <input
                            type="checkbox"
                            checked={automation.status === "운영중"}
                            onChange={() => handleToggleStatus(automation.id)}
                          />
                          <span className="switch-slider"></span>
                        </label>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Realtime Event Simulator Widget */}
              <aside className="builder-panel simulator-card">
                <div className="section-header compact">
                  <div>
                    <p className="eyebrow">Testing Sandbox</p>
                    <h2>인스타 이벤트 시뮬레이터</h2>
                  </div>
                  <div className="simulator-badge">
                    <span className="pulse-indicator"></span> Sandbox
                  </div>
                </div>

                {simAlert && (
                  <div className={`sim-alert ${simAlert.type}`}>
                    {simAlert.type === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <span>{simAlert.message}</span>
                  </div>
                )}

                <form onSubmit={handleSimulate} className="sim-form">
                  <div className="form-group">
                    <label>가상 유저 계정명</label>
                    <input
                      type="text"
                      value={simulatorUser}
                      onChange={(e) => setSimulatorUser(e.target.value)}
                      placeholder="@username"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>이벤트 형태</label>
                    <div className="toggle-group">
                      <button
                        type="button"
                        className={simulatorType === "comment" ? "active" : ""}
                        onClick={() => setSimulatorType("comment")}
                      >
                        릴스/피드 댓글
                      </button>
                      <button
                        type="button"
                        className={simulatorType === "dm" ? "active" : ""}
                        onClick={() => setSimulatorType("dm")}
                      >
                        다이렉트 메시지(DM)
                      </button>
                    </div>
                  </div>

                  {simulatorType === "comment" && (
                    <div className="form-group animate-fade-in">
                      <label>대상 게시물 미디어 ID (선택)</label>
                      <input
                        type="text"
                        value={simulatorMediaId}
                        onChange={(e) => setSimulatorMediaId(e.target.value)}
                        placeholder="예: media_campaign_a"
                      />
                      <small className="help-text">설정하신 특정 릴스 자동화 매칭 테스트 시에 사용합니다.</small>
                    </div>
                  )}

                  <div className="form-group">
                    <label>{simulatorType === "comment" ? "댓글 텍스트 입력" : "보낼 DM 내용 입력"}</label>
                    <textarea
                      value={simulatorText}
                      onChange={(e) => setSimulatorText(e.target.value)}
                      placeholder={
                        simulatorType === "comment"
                          ? "댓글에 '자료' 나 '신청'을 넣어 적어보세요!"
                          : "메시지에 '가격' 이나 '상담'을 넣어보세요!"
                      }
                      rows={3}
                      required
                    />
                  </div>

                  <button type="submit" className="wide-button test-simulate-btn">
                    <Send size={17} /> 시뮬레이터 실행하기
                  </button>
                </form>

                <div className="sim-guide">
                  <p>💡 <strong>시뮬레이터 테스트 가이드:</strong></p>
                  <ul>
                    <li>1. 게시물 ID 지정 시 해당 릴스 전용 규칙이 <strong>글로벌 규칙보다 우선 매칭</strong>됩니다!</li>
                    <li>2. '자료'가 포함된 댓글 작성 시 <strong>'자료' 자동화</strong> 매칭</li>
                    <li>3. 매칭되면 <strong>오늘 발송량</strong>과 <strong>이벤트 로그</strong>가 자동 갱신됩니다!</li>
                  </ul>
                </div>
              </aside>
            </section>

            {/* Bottom Grid */}
            <section className="bottom-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px" }}>
              {/* Event Logs */}
              <div className="activity-panel">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Realtime Stream</p>
                    <h2>실시간 이벤트 로그</h2>
                  </div>
                  <button className="icon-btn-text" onClick={async () => {
                    if (confirm("이벤트 로그를 초기화하시겠습니까?")) {
                      const res = await fetch(`${API_BASE}/events/clear`, { method: "POST" });
                      if (res.ok) fetchEvents();
                    }
                  }}>
                    로그 삭제
                  </button>
                </div>
                <div className="event-list-container">
                  {events.length === 0 ? (
                    <div className="empty-state">
                      <Activity size={24} />
                      <p>로그가 비어 있습니다. 시뮬레이터로 이벤트를 생성해보세요!</p>
                    </div>
                  ) : (
                    events.map((evt) => (
                      <div className={`event-item log-${evt.status}`} key={evt.id}>
                        <time>{evt.time}</time>
                        <div>
                          <strong>{evt.type}</strong>
                          <p>{evt.text}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            {/* Queue Item & Error Tracking Panel */}
            <section className="queue-monitoring-section animate-fade-in">
              <div className="automation-panel">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Queue & Error Monitor</p>
                    <h2>비동기 발송 큐 및 오류 추적</h2>
                  </div>
                  <button className="ghost-button" onClick={async () => {
                    if (confirm("대기열을 전체 초기화하시겠습니까?")) {
                      const res = await fetch(`${API_BASE}/queue/clear`, { method: "POST" });
                      if (res.ok) fetchQueue();
                    }
                  }}>
                    큐 비우기
                  </button>
                </div>

                <div className="table">
                  <div className="table-row table-head" style={{ gridTemplateColumns: "150px 100px minmax(200px, 1.5fr) 100px 100px minmax(150px, 1fr)" }}>
                    <span>대기열 등록 일시</span>
                    <span>수신 대상</span>
                    <span>실제 메시지 본문</span>
                    <span>상태</span>
                    <span>재시도</span>
                    <span>에러 원인 / 실패 사유</span>
                  </div>
                  {queue.length === 0 ? (
                    <div className="empty-state" style={{ gridColumn: "span 6", padding: "30px" }}>
                      <Sliders size={20} />
                      <p>현재 대기열 큐가 비어 있습니다. 시뮬레이터로 이벤트를 생성해 보세요!</p>
                    </div>
                  ) : (
                    queue.map((item) => (
                      <div className="table-row" key={item.id} style={{ gridTemplateColumns: "150px 100px minmax(200px, 1.5fr) 100px 100px minmax(150px, 1fr)" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          {new Date(item.createdAt).toLocaleTimeString()}
                        </span>
                        <strong>@{item.recipientId}</strong>
                        <span className="truncate-text" style={{ fontSize: "13px" }}>{item.body}</span>
                        <span>
                          <span className={`status-badge ${getQueueBadgeClass(item.status)}`}>
                            {item.status}
                          </span>
                        </span>
                        <span>{item.retryCount} / 3회</span>
                        <span style={{ color: item.errorLog ? "var(--accent-rose)" : "var(--text-muted)", fontSize: "12px" }}>
                          {item.errorLog || "에러 없음"}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {/* Tab View: Automations CRUD */}
        {activeTab === "automations" && (
          <section className="automations-tab-layout">
            <div className="automations-list-side">
              <div className="panel-header">
                <h2>등록된 자동화 목록 ({automations.length})</h2>
                <p>Instagram Official API 기반 키워드 매칭 리스트</p>
              </div>

              <div className="table">
                <div className="table-row table-head">
                  <span>자동화 설정 정보</span>
                  <span>트리거</span>
                  <span>발송수</span>
                  <span>상태 ON/OFF</span>
                  <span>관리</span>
                </div>
                {automations.map((a) => (
                  <div className="table-row" key={a.id}>
                    <div className="flow-title">
                      <MessageSquareText size={18} />
                      <div>
                        <strong style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {a.name}
                          {a.targetPostId && (
                            <span className="template-badge" style={{ fontSize: "10px", padding: "2px 6px" }}>
                              릴스: {a.targetPostId}
                            </span>
                          )}
                        </strong>
                        <small className="dm-response-preview">{a.message}</small>
                      </div>
                    </div>
                    <span>
                      <span className={`trigger-tag ${a.triggerType}`}>
                        {a.triggerType === "comment" ? "댓글" : "DM"}
                      </span>{" "}
                      <strong>{a.trigger}</strong>
                    </span>
                    <span>{a.sent}회</span>
                    <span>
                      <label className="switch-toggle">
                        <input
                          type="checkbox"
                          checked={a.status === "운영중"}
                          onChange={() => handleToggleStatus(a.id)}
                        />
                        <span className="switch-slider"></span>
                      </label>
                    </span>
                    <div className="action-buttons">
                      <button className="small-edit-btn" onClick={() => handleEdit(a)}>
                        수정
                      </button>
                      <button className="small-delete-btn" onClick={() => handleDeleteAutomation(a.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Builder Area */}
            <aside className="automations-builder-side">
              <div className="builder-header">
                <h3>{editingId ? "자동화 플로우 수정" : "새로운 자동화 빌더"}</h3>
                <p>지정한 트리거 키워드 감지 시, 발송할 DM 템플릿을 정의합니다.</p>
              </div>

              <form onSubmit={handleSaveAutomation} className="builder-form">
                <div className="form-group">
                  <label>자동화 이름</label>
                  <input
                    type="text"
                    value={newAuto.name}
                    onChange={(e) => setNewAuto({ ...newAuto, name: e.target.value })}
                    placeholder="예: 릴스 신년 이벤트 가이드 배포"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>트리거 유형</label>
                  <select
                    value={newAuto.triggerType}
                    onChange={(e) => {
                      const val = e.target.value as "comment" | "dm";
                      setNewAuto({ ...newAuto, triggerType: val, targetPostId: val === "dm" ? "" : newAuto.targetPostId });
                    }}
                  >
                    <option value="comment">릴스 / 피드 댓글 키워드 매칭</option>
                    <option value="dm">인스타그램 Direct Message (DM) 키워드 매칭</option>
                  </select>
                </div>

                {newAuto.triggerType === "comment" && (
                  <div className="form-group animate-fade-in">
                    <label>특정 릴스/게시물 ID (선택)</label>
                    <input
                      type="text"
                      value={newAuto.targetPostId || ""}
                      onChange={(e) => setNewAuto({ ...newAuto, targetPostId: e.target.value })}
                      placeholder="예: media_campaign_a (비워두면 전체 게시물 반응)"
                    />
                    <small className="help-text">특정 릴스 댓글에만 반응시키려면 인스타 미디어 ID를 입력하세요.</small>
                  </div>
                )}

                <div className="form-group">
                  <label>트리거 키워드 (쉼표로 구분)</label>
                  <input
                    type="text"
                    value={newAuto.trigger}
                    onChange={(e) => setNewAuto({ ...newAuto, trigger: e.target.value })}
                    placeholder="예: 신청,자료,가이드,가격"
                    required
                  />
                  <small className="help-text">사용자가 댓글이나 DM에 이 키워드들을 포함해 쓰면 반응합니다.</small>
                </div>

                <div className="form-group">
                  <label>발송할 DM 메시지 내용</label>
                  <textarea
                    value={newAuto.message}
                    onChange={(e) => setNewAuto({ ...newAuto, message: e.target.value })}
                    placeholder="인스타그램 정책에 따라 발송되는 1회성 자동 DM 내용입니다."
                    rows={6}
                    required
                  />
                  <small className="help-text">24시간 메시징 윈도우 규칙과 템플릿 가이드라인을 준수해주세요.</small>
                </div>

                <div className="form-group">
                  <label>기본 상태 설정</label>
                  <div className="status-selector-row">
                    {(["운영중", "점검"] as Automation["status"][]).map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={`status-select-btn ${newAuto.status === st ? "selected" : ""}`}
                        onClick={() => setNewAuto({ ...newAuto, status: st })}
                      >
                        {st === "운영중" ? "활성화" : "비활성화(점검)"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="builder-actions-row">
                  {editingId && (
                    <button
                      type="button"
                      className="builder-cancel-btn"
                      onClick={() => {
                        setEditingId(null);
                        setNewAuto({ name: "", triggerType: "comment", trigger: "", message: "", status: "운영중", targetPostId: "" });
                      }}
                    >
                      취소
                    </button>
                  )}
                  <button type="submit" className="builder-save-btn">
                    <Check size={18} /> {editingId ? "수정사항 저장" : "자동화 저장 및 배포"}
                  </button>
                </div>
              </form>
            </aside>
          </section>
        )}

        {/* Tab View: Leads */}
        {activeTab === "leads" && (
          <section className="leads-tab-layout">
            <div className="panel-header">
              <h2>연결된 인바운드 리드 목록</h2>
              <p>자동 DM 발송을 통해 첫 관계가 생성되고 대화가 오간 리드 목록입니다.</p>
            </div>

            <div className="leads-summary-row">
              <div className="lead-summary-card">
                <span>전체 유치 리드</span>
                <strong>{leads.length}명</strong>
              </div>
              <div className="lead-summary-card">
                <span>상담 진행중</span>
                <strong>{leads.filter((l) => l.status === "상담중").length}명</strong>
              </div>
              <div className="lead-summary-card">
                <span>전환 완료</span>
                <strong>{leads.filter((l) => l.status === "전환완료").length}명</strong>
              </div>
            </div>

            <div className="table">
              <div className="table-row table-head">
                <span>인스타그램 ID</span>
                <span>유입 경로</span>
                <span>주고받은 메시지</span>
                <span>마지막 발송 내용</span>
                <span>마지막 활성</span>
                <span>진행 상태</span>
              </div>
              {leads.map((lead) => (
                <div className="table-row" key={lead.id}>
                  <div className="lead-identity">
                    <div className="lead-avatar">
                      <User size={16} />
                    </div>
                    <strong>@{lead.username}</strong>
                  </div>
                  <span>
                    <span className={`trigger-tag ${lead.source === "댓글" ? "comment" : "dm"}`}>
                      {lead.source}
                    </span>
                  </span>
                  <span>{lead.messagesCount}회</span>
                  <span className="truncate-text last-msg-text">{lead.lastMessage}</span>
                  <span>{lead.lastActive}</span>
                  <span>
                    <select
                      className={`lead-status-select select-${lead.status}`}
                      value={lead.status}
                      onChange={(e) => handleLeadStatusChange(lead.id, e.target.value as Lead["status"])}
                    >
                      <option value="대기">대기</option>
                      <option value="상담중">상담중</option>
                      <option value="전환완료">전환완료</option>
                    </select>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tab View: Templates */}
        {activeTab === "templates" && (
          <section className="templates-tab-layout">
            <div className="templates-left">
              <div className="panel-header">
                <h2>메시지 템플릿 보관함</h2>
                <p>자동 DM 작성에 재사용할 수 있는 고성능 반응형 템플릿입니다.</p>
              </div>

              <div className="templates-grid">
                {templates.map((temp) => (
                  <article className="template-card" key={temp.id}>
                    <div className="card-header">
                      <span className="template-badge">{temp.type}</span>
                      <button className="delete-temp-btn" onClick={() => handleDeleteTemplate(temp.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <h3>{temp.name}</h3>
                    <p className="temp-content-preview">{temp.content}</p>
                    <button className="apply-temp-btn" onClick={() => handleApplyTemplate(temp)}>
                      <Workflow size={14} /> 자동화 규칙에 적용하기
                    </button>
                  </article>
                ))}
              </div>
            </div>

            <aside className="templates-right">
              <h3>새 템플릿 추가</h3>
              <p>반복 사용하는 대외비 발송 문안을 저장하세요.</p>

              <form onSubmit={handleCreateTemplate} className="template-form">
                <div className="form-group">
                  <label>템플릿 이름</label>
                  <input
                    type="text"
                    value={newTemp.name}
                    onChange={(e) => setNewTemp({ ...newTemp, name: e.target.value })}
                    placeholder="예: 7월 특별 프로모션 DM"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>분류</label>
                  <select
                    value={newTemp.type}
                    onChange={(e) => setNewTemp({ ...newTemp, type: e.target.value })}
                  >
                    <option value="자료 배포">자료 배포</option>
                    <option value="고객 상담">고객 상담</option>
                    <option value="가격 문의">가격 문의</option>
                    <option value="이벤트">이벤트</option>
                    <option value="일반 안내">일반 안내</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>메시지 본문</label>
                  <textarea
                    value={newTemp.content}
                    onChange={(e) => setNewTemp({ ...newTemp, content: e.target.value })}
                    placeholder="보내고자 하는 상세 DM 텍스트를 적으세요."
                    rows={8}
                    required
                  />
                </div>

                <button type="submit" className="wide-button">
                  템플릿 저장하기
                </button>
              </form>
            </aside>
          </section>
        )}

        {/* Tab View: Settings */}
        {activeTab === "settings" && (
          <section className="settings-tab-layout">
            <div className="settings-section">
              <h2>Meta / Instagram API 연동 관리</h2>
              <p>Meta Developer App 및 Instagram Professional 계정 인증을 관리합니다.</p>

              <div className="meta-connection-card">
                <div className="meta-status">
                  <div className={`meta-status-indicator ${metaConnected ? "online" : "offline"}`}></div>
                  <div>
                    <strong>{metaConnected ? "Meta API 연동 활성화" : "Meta API 연동 비활성화"}</strong>
                    <p>{metaConnected ? "Instagram Business 계정이 안전하게 연결되었습니다." : "자동 발송 트리거를 위해 Meta 로그인이 필요합니다."}</p>
                  </div>
                </div>

                {metaConnected && metaAccount ? (
                  <div className="connected-profile">
                    <div className="profile-info">
                      <div className="meta-avatar">
                        <Camera size={20} />
                      </div>
                      <div>
                        <strong>{metaAccount.username} (Instagram Professional)</strong>
                        <span>Token 만료: 60일 후 ({metaAccount.tokenExpires ? new Date(metaAccount.tokenExpires).toLocaleDateString() : "2026-08-31"})</span>
                      </div>
                    </div>
                    <button className="disconnect-btn" onClick={handleDisconnectMeta}>
                      연동 해제
                    </button>
                  </div>
                ) : (
                  <div className="connect-action-block">
                    <button
                      className="meta-oauth-btn"
                      onClick={handleConnectMeta}
                      disabled={metaLoading}
                    >
                      {metaLoading ? (
                        <>
                          <RefreshCw className="animate-spin" size={18} /> Meta 로그인 처리 중...
                        </>
                      ) : (
                        <>
                          <Camera size={18} /> Facebook으로 로그인 (Instagram 권한 획득)
                        </>
                      )}
                    </button>
                    <p className="oauth-notice">
                      * `instagram_business_manage_messages`, `instagram_business_manage_comments` 권한이 요구됩니다.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Paywall Subscription pricing plan setting panel */}
            <div className="settings-section">
              <h2>서비스 멤버십 플랜 변경</h2>
              <p>도입 규모에 따라 인스타그램 API 일일 최대 한도를 차등 관리합니다.</p>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "12px" }}>
                <div 
                  className={`template-card ${currentPlan === "basic" ? "simulator-card" : ""}`} 
                  onClick={() => handleUpdatePlan("basic")}
                  style={{ cursor: "pointer", border: currentPlan === "basic" ? "1px solid var(--accent-emerald)" : "1px solid var(--border-color)", padding: "18px" }}
                >
                  <span className="template-badge" style={{ background: currentPlan === "basic" ? "var(--accent-emerald-glow)" : "rgba(255,255,255,0.03)" }}>BASIC PLAN</span>
                  <h3 style={{ margin: "8px 0 4px" }}>베이직 요금제</h3>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>월 29,000원</p>
                  <p style={{ fontSize: "13px", color: "var(--text-primary)", marginTop: "10px" }}>🛡️ 일일 발송 제한: <strong>100건</strong></p>
                  <button className="apply-temp-btn" style={{ marginTop: "12px", background: currentPlan === "basic" ? "var(--accent-emerald)" : "", color: currentPlan === "basic" ? "#050707" : "" }} disabled={currentPlan === "basic"}>
                    {currentPlan === "basic" ? "사용 중인 플랜" : "베이직 선택"}
                  </button>
                </div>

                <div 
                  className={`template-card ${currentPlan === "pro" ? "simulator-card" : ""}`} 
                  onClick={() => handleUpdatePlan("pro")}
                  style={{ cursor: "pointer", border: currentPlan === "pro" ? "1px solid var(--accent-emerald)" : "1px solid var(--border-color)", padding: "18px" }}
                >
                  <span className="template-badge" style={{ background: currentPlan === "pro" ? "var(--accent-emerald-glow)" : "rgba(255,255,255,0.03)" }}>PRO PLAN</span>
                  <h3 style={{ margin: "8px 0 4px" }}>프로 요금제</h3>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>월 59,000원</p>
                  <p style={{ fontSize: "13px", color: "var(--text-primary)", marginTop: "10px" }}>🔥 일일 발송 제한: <strong>1,000건</strong></p>
                  <button className="apply-temp-btn" style={{ marginTop: "12px", background: currentPlan === "pro" ? "var(--accent-emerald)" : "", color: currentPlan === "pro" ? "#050707" : "" }} disabled={currentPlan === "pro"}>
                    {currentPlan === "pro" ? "사용 중인 플랜" : "프로 선택"}
                  </button>
                </div>
              </div>
            </div>

            {/* Administrator notification configuration card (고도화 3단계) */}
            <div className="settings-section">
              <h2>관리자 알림 경보 설정 (Slack / Discord)</h2>
              <p>큐 발송 실패, 세션 만료 차단, Meta API 오류 시 관리자 채널로 실시간 PUSH 경보를 발송합니다.</p>

              <form onSubmit={handleSaveNotificationUrl} className="webhook-settings-form">
                <div className="form-group">
                  <label>Webhook URL (Slack Webhook 또는 Discord Webhook 주소)</label>
                  <input
                    type="url"
                    value={notificationUrlInput}
                    onChange={(e) => setNotificationUrlInput(e.target.value)}
                    placeholder="https://hooks.slack.com/services/... 또는 https://discord.com/api/webhooks/..."
                  />
                  <small className="help-text">
                    입력된 Webhook 채널로 주요 발송 실패 및 한도 소진 경보가 실시간 PUSH됩니다.
                  </small>
                </div>

                <div className="webhook-status-row" style={{ marginTop: "15px" }}>
                  <button type="submit" className="primary-button" style={{ height: "42px" }}>
                    알림 설정 저장
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={handleTestNotification}
                    style={{ height: "42px", padding: "0 20px" }}
                  >
                    테스트 알림 발송
                  </button>
                </div>
              </form>
            </div>

            {/* Custom daily threshold input control */}
            <div className="settings-section">
              <h2>일일 상세 한도 임계치 설정</h2>
              <p>플랜 정책 범위 내에서 자동 DM 발송 상세 한도를 수동 커스텀 설정합니다.</p>

              <form onSubmit={handleUpdateDailyLimit} className="webhook-settings-form">
                <div className="form-group">
                  <label>일일 최대 자동 DM 발송 제한량</label>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <input
                      type="number"
                      value={dailyLimitInput}
                      onChange={(e) => setDailyLimitInput(Number(e.target.value))}
                      min={1}
                      style={{ maxWidth: "200px" }}
                      required
                    />
                    <button type="submit" className="primary-button" style={{ height: "42px" }}>
                      제한량 적용 및 저장
                    </button>
                  </div>
                  <small className="help-text">
                    하루 발송량이 이 수치를 초과하면 대기열 메시지는 오류로그와 함께 보류됩니다.
                  </small>
                </div>
              </form>
            </div>

            {/* GDPR & Deauthorize callback configuration */}
            <div className="settings-section">
              <h2>Meta 개인정보 정책 및 데이터 삭제 설정</h2>
              <p>Meta Developer App 연동 필수 조건인 GDPR 개인정보 관리와 데이터 삭제 이행 규격입니다.</p>

              <div className="meta-connection-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <strong>Data Deletion Callback URL (데이터 삭제 지시 콜백)</strong>
                  <code style={{ display: "block", background: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "6px", fontSize: "12px", marginTop: "6px" }}>
                    http://localhost:5000/api/auth/deauthorize
                  </code>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px" }}>
                  <p style={{ fontStyle: "italic", fontSize: "12px", color: "var(--text-secondary)", maxWidth: "70%", margin: 0 }}>
                    * 사용자가 페이스북 대시보드에서 연동 해제를 요청하면 이 API가 즉시 작동하여 토큰을 영구 파기합니다.
                  </p>
                  <button className="disconnect-btn" onClick={handleSimulateDeauthorize} style={{ height: "36px", padding: "0 15px", whiteSpace: "nowrap" }}>
                    모의 데이터 삭제 테스트
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h2>Meta Webhook 실시간 수신 설정 (모의)</h2>
              <p>댓글 및 Direct Message 이벤트를 실시간으로 구독하기 위한 엔드포인트 정보입니다.</p>

              <form onSubmit={handleSaveWebhook} className="webhook-settings-form">
                <div className="form-group">
                  <label>Callback URL</label>
                  <input
                    type="text"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://yourdomain.com/webhook"
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Verify Token</label>
                  <input
                    type="password"
                    value={webhookToken}
                    onChange={(e) => setWebhookToken(e.target.value)}
                    required
                  />
                  <small className="help-text">Meta 앱 대시보드의 Webhook 인증 토큰값과 일치해야 합니다.</small>
                </div>

                <div className="webhook-status-row">
                  <div className="webhook-badge-container">
                    <span className={`wh-status-badge ${webhookVerified ? "verified" : "unverified"}`}>
                      {webhookVerified ? "검증 완료 (Verified)" : "검증되지 않음"}
                    </span>
                  </div>
                  <button type="submit" className="webhook-verify-btn">
                    주소 저장 및 Webhook Handshake 테스트
                  </button>
                </div>
              </form>
            </div>

            <div className="settings-section">
              <h2>개인정보 & 이용 약관 검수 설정</h2>
              <p>Meta 앱 검수 시 요구되는 고유 정보 링크 목록입니다.</p>

              <div className="policy-settings-grid">
                <div className="form-group">
                  <label>개인정보 처리방침 (Privacy Policy URL)</label>
                  <input type="url" defaultValue="https://dmlaunch.io/privacy" placeholder="https://..." />
                </div>
                <div className="form-group">
                  <label>서비스 이용약관 (Terms of Service URL)</label>
                  <input type="url" defaultValue="https://dmlaunch.io/terms" placeholder="https://..." />
                </div>
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

// Subcomponents
function Metric({
  icon,
  label,
  value,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </article>
  );
}

export default App;
