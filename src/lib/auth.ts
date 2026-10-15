// Session token: "<expiresAtMs>.<hmac>". Uses Web Crypto so it runs in any runtime.

export const SESSION_COOKIE = "session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;

const enc = new TextEncoder();

function toBase64Url(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64url");
}

/** Signing secret: SESSION_SECRET, or derived from APP_PASSWORD. Null if neither is set. */
export function sessionSecret(env: Env = process.env): string | null {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.APP_PASSWORD) return `pw:${env.APP_PASSWORD}`;
  return null;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_TTL_MS);
  return `${exp}.${await hmac(secret, exp)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(sig, await hmac(secret, exp));
}

/** Constant-time password check (compares HMACs, so length doesn't leak). */
export async function checkPassword(input: string, env: Env = process.env): Promise<boolean> {
  const expected = env.APP_PASSWORD;
  if (!expected) return false;
  const key = "password-check";
  return safeEqual(await hmac(key, input), await hmac(key, expected));
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
