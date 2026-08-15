export type MetaReadinessStatus = "ready" | "attention" | "not_configured";

const present = (value?: string) => Boolean(value?.trim() && !/(change|example|placeholder|your)/i.test(value));
const secureUrl = (value?: string) => { try { return new URL(value ?? "").protocol === "https:"; } catch { return false; } };

export function buildMetaReadinessReport() {
  const rows: Array<[string, string, boolean, MetaReadinessStatus]> = [
    ["app-id", "Meta App ID", present(process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID), "not_configured"],
    ["app-secret", "앱 시크릿", present(process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET), "not_configured"],
    ["verify-token", "Webhook 검증 토큰", present(process.env.META_VERIFY_TOKEN), "not_configured"],
    ["webhook-url", "Webhook 콜백 URL", secureUrl(process.env.META_WEBHOOK_URL), "attention"],
    ["oauth-redirect", "OAuth 리디렉션 URL", secureUrl(process.env.META_OAUTH_REDIRECT_URL), "attention"],
    ["app-mode", "앱 운영 모드", process.env.META_APP_MODE?.toLowerCase() === "live", "attention"],
  ];
  const checks = rows.map(([id, label, ok, missing]) => ({
    id, label, status: ok ? "ready" : missing,
    detail: ok ? `${label} 설정을 확인했습니다.` : `${label} 설정 또는 Meta Dashboard 확인이 필요합니다.`,
    action: ok ? "배포 환경과 Meta Dashboard 상태를 정기 점검하세요." : "서버 환경 변수와 Meta App Dashboard 설정을 점검하세요.",
  }));
  const overallStatus: MetaReadinessStatus = checks.some((check) => check.status === "not_configured") ? "not_configured" : checks.some((check) => check.status === "attention") ? "attention" : "ready";
  return { generatedAt: new Date().toISOString(), overallStatus, checks, requiredPermissions: (process.env.META_REQUIRED_PERMISSIONS ?? "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments").split(","), documentationUrl: "https://developers.facebook.com/documentation/instagram-platform/overview" };
}
