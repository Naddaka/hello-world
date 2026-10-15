import { describe, expect, it } from "vitest";
import type { Model } from "@/db/schema";
import { BYTEPLUS_MODELS } from "@/db/seed";
import { BYTEPLUS_BASE_URL, bytePlusErrorMessage, createBytePlusAdapter } from "@/providers/byteplus";

const KEY = "bp-test-key";
const model = { ...BYTEPLUS_MODELS[0], enabled: true } as unknown as Model; // Seedance 2.5
const TASKS = `${BYTEPLUS_BASE_URL}/contents/generations/tasks`;
const IMG_ID = "123e4567-e89b-12d3-a456-426614174000.png";

type Call = { url: string; method: string; headers: Record<string, string>; body?: Record<string, unknown> };

function fakeBytePlus(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const r = routes[`${method} ${url}`];
    return r ? r() : new Response("{}", { status: 599 });
  }) as unknown as typeof globalThis.fetch;
  const adapter = createBytePlusAdapter({
    apiKey: () => KEY,
    readImage: async (id) => `data:image/png;base64,FAKE-${id}`,
    fetch: fakeFetch,
  });
  return { calls, adapter };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });

describe("BytePlus: create task", () => {
  it("text-to-video: prompt as text content, params passed through, Bearer auth", async () => {
    const { adapter, calls } = fakeBytePlus({ [`POST ${TASKS}`]: json({ id: "cgt-1" }) });
    const id = await adapter.generate(model, {
      prompt: "a fox in the snow",
      params: { resolution: "1080p", ratio: "16:9", duration: 10, generate_audio: true, watermark: false, image_role: "first_frame" },
    });
    expect(id).toBe("cgt-1");
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toEqual({
      model: "dreamina-seedance-2-5-260628",
      content: [{ type: "text", text: "a fox in the snow" }],
      resolution: "1080p",
      ratio: "16:9",
      duration: 10,
      generate_audio: true,
      watermark: false,
    });
  });

  it("first-frame image: base64 data URI, role first_frame, ratio forced to adaptive", async () => {
    const { adapter, calls } = fakeBytePlus({ [`POST ${TASKS}`]: json({ id: "cgt-2" }) });
    await adapter.generate(model, { prompt: "p", params: { ratio: "16:9", duration: 5, image: IMG_ID, image_role: "first_frame" } });
    expect(calls[0].body).toMatchObject({
      ratio: "adaptive",
      content: [
        { type: "text", text: "p" },
        { type: "image_url", image_url: { url: `data:image/png;base64,FAKE-${IMG_ID}` }, role: "first_frame" },
      ],
    });
    expect(calls[0].body).not.toHaveProperty("image");
    expect(calls[0].body).not.toHaveProperty("image_role");
  });

  it("reference image keeps the chosen ratio", async () => {
    const { adapter, calls } = fakeBytePlus({ [`POST ${TASKS}`]: json({ id: "cgt-3" }) });
    await adapter.generate(model, { prompt: "p", params: { ratio: "9:16", image: IMG_ID, image_role: "reference_image" } });
    expect(calls[0].body).toMatchObject({ ratio: "9:16", content: [{}, { role: "reference_image" }] });
  });

  it("API errors become readable messages without the key", async () => {
    const { adapter } = fakeBytePlus({
      [`POST ${TASKS}`]: json({ error: { code: "AuthenticationError", message: "The API key format is incorrect.", type: "Unauthorized" } }, 401),
    });
    const err = await adapter.generate(model, { prompt: "p", params: {} }).catch((e: Error) => e);
    expect(String(err)).toContain("BytePlus: The API key format is incorrect. (AuthenticationError, HTTP 401)");
    expect(String(err)).not.toContain(KEY);
  });

  it("refuses to run without BYTEPLUS_API_KEY", async () => {
    const adapter = createBytePlusAdapter({ apiKey: () => "", readImage: async () => "" });
    await expect(adapter.generate(model, { prompt: "p", params: {} })).rejects.toThrow("BYTEPLUS_API_KEY");
  });
});

describe("BytePlus: retrieve task", () => {
  const status = (body: unknown, code = 200) => fakeBytePlus({ [`GET ${TASKS}/cgt-1`]: json(body, code) }).adapter.getStatus(model, "cgt-1");

  it("maps queued / running", async () => {
    expect(await status({ status: "queued" })).toEqual({ status: "queued" });
    expect(await status({ status: "running" })).toEqual({ status: "running" });
  });

  it("succeeded → video URL and token usage", async () => {
    expect(
      await status({
        id: "cgt-1",
        status: "succeeded",
        content: { video_url: "https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/x.mp4" },
        usage: { completion_tokens: 108900, total_tokens: 108900 },
      }),
    ).toEqual({
      status: "done",
      resultUrls: ["https://ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com/x.mp4"],
      usage: { tokens: 108900 },
    });
  });

  it("failed / expired / cancelled → failed with a message", async () => {
    expect(await status({ status: "failed", error: { code: "InvalidParameter.TaskTypeConstraint", message: "ratio must be adaptive" } })).toEqual({
      status: "failed",
      error: "BytePlus: ratio must be adaptive (InvalidParameter.TaskTypeConstraint)",
    });
    expect(await status({ status: "failed", error: null })).toMatchObject({ status: "failed" });
    expect(await status({ status: "expired" })).toMatchObject({ status: "failed", error: expect.stringContaining("expired") });
    expect(await status({ status: "cancelled" })).toMatchObject({ status: "failed" });
  });

  it("404 fails; 429 and 5xx throw so the worker retries", async () => {
    expect(await status({ error: { code: "NotFound", message: "task not found" } }, 404)).toMatchObject({ status: "failed" });
    await expect(status({ error: { code: "RateLimit", message: "slow down" } }, 429)).rejects.toThrow("HTTP 429");
    await expect(status({}, 503)).rejects.toThrow("HTTP 503");
  });

  it("escapes the task id in the URL", async () => {
    const { adapter, calls } = fakeBytePlus({});
    await adapter.getStatus(model, "../evil").catch(() => {});
    expect(calls[0].url).toBe(`${TASKS}/..%2Fevil`);
  });
});

describe("bytePlusErrorMessage", () => {
  it("falls back to HTTP status", () => {
    expect(bytePlusErrorMessage(500, {})).toBe("BytePlus: HTTP 500");
  });
});
