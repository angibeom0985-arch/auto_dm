import crypto from "node:crypto";

const TOKEN_VERSION = "v1";
const STATE_TTL_MS = 10 * 60 * 1000;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function encryptionKey(): Buffer {
  const source = required("META_TOKEN_ENCRYPTION_KEY");
  const key = /^[a-f0-9]{64}$/i.test(source)
    ? Buffer.from(source, "hex")
    : Buffer.from(source, "base64");

  if (key.length !== 32) {
    throw new Error("META_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key");
  }
  return key;
}

function stateSecret(): Buffer {
  const value = process.env.META_OAUTH_STATE_SECRET?.trim();
  return value ? Buffer.from(value, "utf8") : encryptionKey();
}

function safeEqual(actual: Buffer, expected: Buffer): boolean {
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function encryptMetaToken(token: string): string {
  if (!token.trim()) throw new Error("Cannot encrypt an empty Meta access token");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptMetaToken(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== TOKEN_VERSION || !ivText || !tagText || !ciphertextText) {
    throw new Error("Stored Meta access token has an unsupported encryption format");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export function createOAuthState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + STATE_TTL_MS }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${TOKEN_VERSION}.${payload}.${signature}`;
}

export function readOAuthState(state: string): { userId: string } {
  const [version, payload, signature] = state.split(".");
  if (version !== TOKEN_VERSION || !payload || !signature) throw new Error("Invalid OAuth state");

  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  if (!safeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid OAuth state signature");

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId?: string; exp?: number };
  if (!parsed.userId || !parsed.exp || parsed.exp < Date.now()) throw new Error("OAuth state has expired");
  return { userId: parsed.userId };
}

export function verifyMetaWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  const secret = process.env.META_APP_SECRET?.trim();
  if (!rawBody || !signature || !secret || !signature.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"));
}
