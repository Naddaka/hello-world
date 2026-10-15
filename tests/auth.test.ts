import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  checkPassword,
  createSessionToken,
  safeNextPath,
  sessionSecret,
  verifySessionToken,
} from "@/lib/auth";

describe("session token", () => {
  it("accepts a fresh token signed with the same secret", async () => {
    const t = await createSessionToken("s1");
    expect(await verifySessionToken(t, "s1")).toBe(true);
  });

  it("rejects wrong secret, tampering, expiry and garbage", async () => {
    const now = Date.now();
    const t = await createSessionToken("s1", now);
    expect(await verifySessionToken(t, "s2")).toBe(false);
    const [exp, sig] = t.split(".");
    expect(await verifySessionToken(`${Number(exp) + 1}.${sig}`, "s1")).toBe(false);
    expect(await verifySessionToken(t, "s1", now + SESSION_TTL_MS + 1)).toBe(false);
    expect(await verifySessionToken("nope", "s1")).toBe(false);
    expect(await verifySessionToken(undefined, "s1")).toBe(false);
    expect(await verifySessionToken(t, null)).toBe(false);
  });
});

describe("password", () => {
  it("matches only APP_PASSWORD", async () => {
    const env = { APP_PASSWORD: "secret" };
    expect(await checkPassword("secret", env)).toBe(true);
    expect(await checkPassword("secre", env)).toBe(false);
    expect(await checkPassword("", env)).toBe(false);
  });

  it("fails closed without APP_PASSWORD", async () => {
    expect(await checkPassword("", {})).toBe(false);
    expect(sessionSecret({})).toBeNull();
  });

  it("changing the password invalidates sessions", async () => {
    const t = await createSessionToken(sessionSecret({ APP_PASSWORD: "a" })!);
    expect(await verifySessionToken(t, sessionSecret({ APP_PASSWORD: "b" }))).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("allows only local paths", () => {
    expect(safeNextPath("/history?x=1")).toBe("/history?x=1");
    expect(safeNextPath("https://evil.com")).toBe("/");
    expect(safeNextPath("//evil.com")).toBe("/");
    expect(safeNextPath("/\\evil.com")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
