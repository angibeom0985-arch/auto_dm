const API_VERSION = process.env.META_GRAPH_API_VERSION?.trim() || "v26.0";
const DEFAULT_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

interface OAuthCodePayload {
  data?: Array<{ access_token?: string; user_id?: string; permissions?: string | string[] }>;
  error_type?: string;
  error_message?: string;
}

interface LongTokenPayload {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
}

interface ProfilePayload {
  id?: string;
  username?: string;
  error?: { message?: string };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T;
  if (!response.ok) {
    const message = (payload as { error_message?: string; error?: { message?: string } }).error_message
      ?? (payload as { error?: { message?: string } }).error?.message
      ?? `Meta API request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export function buildInstagramAuthorizationUrl(state: string): string {
  const appId = required("META_APP_ID");
  const redirectUri = required("META_OAUTH_REDIRECT_URL");
  const scopes = process.env.META_OAUTH_SCOPES?.trim() || DEFAULT_SCOPES.join(",");
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface MetaOAuthConnection {
  instagramId: string;
  username: string;
  accessToken: string;
  tokenExpires: Date;
  permissions: string[];
  subscribed: boolean;
}

export async function connectInstagramBusinessAccount(code: string): Promise<MetaOAuthConnection> {
  const appId = required("META_APP_ID");
  const appSecret = required("META_APP_SECRET");
  const redirectUri = required("META_OAUTH_REDIRECT_URL");

  const form = new FormData();
  form.set("client_id", appId);
  form.set("client_secret", appSecret);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);
  form.set("code", code.replace(/#_$/, ""));

  const shortPayload = await parseResponse<OAuthCodePayload>(await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form,
  }));
  const shortToken = shortPayload.data?.[0]?.access_token;
  const scopedUserId = shortPayload.data?.[0]?.user_id;
  if (!shortToken || !scopedUserId) throw new Error("Meta OAuth response did not contain an Instagram user token and ID");

  const longTokenUrl = new URL("https://graph.instagram.com/access_token");
  longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
  longTokenUrl.searchParams.set("client_secret", appSecret);
  longTokenUrl.searchParams.set("access_token", shortToken);
  const longPayload = await parseResponse<LongTokenPayload>(await fetch(longTokenUrl));
  if (!longPayload.access_token || !longPayload.expires_in) throw new Error("Meta token exchange did not return a long-lived token");

  const profileUrl = new URL(`https://graph.instagram.com/${API_VERSION}/${scopedUserId}`);
  profileUrl.searchParams.set("fields", "id,username");
  profileUrl.searchParams.set("access_token", longPayload.access_token);
  const profile = await parseResponse<ProfilePayload>(await fetch(profileUrl));
  if (!profile.id || !profile.username) throw new Error("Instagram professional account profile could not be read");

  const subscribedFields = process.env.META_WEBHOOK_FIELDS?.trim() || "messages,comments,messaging_postbacks";
  const subscribeUrl = new URL(`https://graph.instagram.com/${API_VERSION}/${profile.id}/subscribed_apps`);
  subscribeUrl.searchParams.set("subscribed_fields", subscribedFields);
  subscribeUrl.searchParams.set("access_token", longPayload.access_token);
  const subscribeResponse = await fetch(subscribeUrl, { method: "POST" });
  const subscribed = subscribeResponse.ok;

  return {
    instagramId: profile.id,
    username: profile.username,
    accessToken: longPayload.access_token,
    tokenExpires: new Date(Date.now() + longPayload.expires_in * 1000),
    permissions: Array.isArray(shortPayload.data?.[0]?.permissions)
      ? shortPayload.data![0].permissions as string[]
      : String(shortPayload.data?.[0]?.permissions || "").split(",").map((item) => item.trim()).filter(Boolean),
    subscribed,
  };
}
