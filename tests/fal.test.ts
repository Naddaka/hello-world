import { describe, expect, it } from "vitest";
import type { Model } from "@/db/schema";
import { FAL_MODELS } from "@/db/seed";
import { createFalAdapter, falErrorMessage, falResultUrls } from "@/providers/fal";

const KEY = "test-key-123";
const model = { ...FAL_MODELS[0], enabled: true, priceRules: null } as unknown as Model; // kling, multi-segment endpoint id

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

/** Fake fetch: routes by "METHOD url" to canned responses, records every call. */
function fakeFal(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[`${method} ${url}`];
    if (!route) return new Response(JSON.stringify({ detail: "no route" }), { status: 599 });
    return route();
  }) as unknown as typeof globalThis.fetch;
  return { calls, adapter: createFalAdapter({ apiKey: () => KEY, fetch: fakeFetch }) };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// fal returns status/response URLs on the app root, not on the full endpoint path.
const STATUS = "https://queue.fal.run/fal-ai/kling-video/requests/req-1/status";
const RESPONSE = "https://queue.fal.run/fal-ai/kling-video/requests/req-1";
const SUBMIT = "https://queue.fal.run/fal-ai/kling-video/v3/pro/text-to-video";
const submitOk = json({ request_id: "req-1", status_url: STATUS, response_url: RESPONSE, queue_position: 0 });

async function submitted(routes: Record<string, () => Response>) {
  const f = fakeFal({ [`POST ${SUBMIT}`]: submitOk, ...routes });
  const id = await f.adapter.generate(model, { prompt: "a fox", params: { duration: "5", generate_audio: false } });
  return { ...f, id };
}

describe("fal adapter: submit", () => {
  it("POSTs prompt + params to the queue with the key header", async () => {
    const { calls, id } = await submitted({});
    expect(calls[0]).toMatchObject({
      url: SUBMIT,
      method: "POST",
      headers: { authorization: `Key ${KEY}`, "content-type": "application/json" },
      body: { prompt: "a fox", duration: "5", generate_audio: false },
    });
    expect(JSON.parse(id)).toEqual({ id: "req-1", status: STATUS, response: RESPONSE });
  });

  it("throws a readable error on validation failure", async () => {
    const f = fakeFal({
      [`POST ${SUBMIT}`]: json({ detail: [{ loc: ["body", "duration"], msg: "Input should be '5' or '10'", type: "enum" }] }, 422),
    });
    await expect(f.adapter.generate(model, { prompt: "x", params: {} })).rejects.toThrow(
      "fal.ai: duration: Input should be '5' or '10' (HTTP 422)",
    );
  });

  it("throws on auth error without leaking the key", async () => {
    const f = fakeFal({ [`POST ${SUBMIT}`]: json({ detail: "invalid key credentials" }, 401) });
    const err = await f.adapter.generate(model, { prompt: "x", params: {} }).catch((e: Error) => e);
    expect(String(err)).toContain("invalid key credentials (HTTP 401)");
    expect(String(err)).not.toContain(KEY);
  });

  it("refuses to run without FAL_KEY", async () => {
    const adapter = createFalAdapter({ apiKey: () => undefined, fetch: (() => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch });
    await expect(adapter.generate(model, { prompt: "x", params: {} })).rejects.toThrow("FAL_KEY");
  });
});

describe("fal adapter: status and result", () => {
  it("maps IN_QUEUE / IN_PROGRESS", async () => {
    let state = "IN_QUEUE";
    const { adapter, id } = await submitted({ [`GET ${STATUS}`]: () => json({ status: state, request_id: "req-1" })() });
    expect(await adapter.getStatus(model, id)).toEqual({ status: "queued" });
    state = "IN_PROGRESS";
    expect(await adapter.getStatus(model, id)).toEqual({ status: "running" });
  });

  it("COMPLETED → fetches the result and returns the video URL", async () => {
    const { adapter, id, calls } = await submitted({
      [`GET ${STATUS}`]: json({ status: "COMPLETED", metrics: { inference_time: 42 } }),
      [`GET ${RESPONSE}`]: json({ video: { url: "https://v3b.fal.media/files/out.mp4", content_type: "video/mp4" } }),
    });
    expect(await adapter.getStatus(model, id)).toEqual({ status: "done", resultUrls: ["https://v3b.fal.media/files/out.mp4"] });
    expect(calls.at(-1)?.headers.authorization).toBe(`Key ${KEY}`);
  });

  it("COMPLETED with error → failed with the message", async () => {
    const { adapter, id } = await submitted({
      [`GET ${STATUS}`]: json({ status: "COMPLETED", error: "Request timed out", error_type: "request_timeout" }),
    });
    expect(await adapter.getStatus(model, id)).toEqual({ status: "failed", error: "fal.ai: Request timed out (request_timeout)" });
  });

  it("result 422 (e.g. content policy) → failed; result 5xx → throws so the worker retries", async () => {
    const policy = await submitted({
      [`GET ${STATUS}`]: json({ status: "COMPLETED" }),
      [`GET ${RESPONSE}`]: json({ detail: [{ loc: ["body", "prompt"], msg: "Content policy violation", type: "content_policy_violation" }] }, 422),
    });
    expect(await policy.adapter.getStatus(model, policy.id)).toEqual({
      status: "failed",
      error: "fal.ai: prompt: Content policy violation (HTTP 422)",
    });

    const flaky = await submitted({
      [`GET ${STATUS}`]: json({ status: "COMPLETED" }),
      [`GET ${RESPONSE}`]: json({ detail: "Internal error", error_type: "internal_error" }, 500),
    });
    await expect(flaky.adapter.getStatus(model, flaky.id)).rejects.toThrow("HTTP 500");
  });

  it("status endpoint 5xx throws (transient), 404 fails", async () => {
    const down = await submitted({ [`GET ${STATUS}`]: json({ detail: "Bad gateway" }, 502) });
    await expect(down.adapter.getStatus(model, down.id)).rejects.toThrow("HTTP 502");
    const gone = await submitted({ [`GET ${STATUS}`]: json({ detail: "not found" }, 404) });
    expect(await gone.adapter.getStatus(model, gone.id)).toMatchObject({ status: "failed" });
  });

  it("never sends the key to a non-fal host", async () => {
    const f = fakeFal({});
    const evil = JSON.stringify({ id: "x", status: "https://evil.example/status", response: "https://evil.example/r" });
    await expect(f.adapter.getStatus(model, evil)).rejects.toThrow("неожиданный адрес");
    expect(f.calls).toHaveLength(0);
  });

  it("accepts a bare request id (URLs built from the endpoint id)", async () => {
    const img = { ...model, providerModelId: "fal-ai/nano-banana-pro" } as Model;
    const f = fakeFal({ "GET https://queue.fal.run/fal-ai/nano-banana-pro/requests/r9/status": json({ status: "IN_PROGRESS" }) });
    expect(await f.adapter.getStatus(img, "r9")).toEqual({ status: "running" });
  });
});

describe("helpers", () => {
  it("falResultUrls handles video, images and empty outputs", () => {
    expect(falResultUrls({ images: [{ url: "a.png" }, { url: "b.png" }], description: "" })).toEqual(["a.png", "b.png"]);
    expect(falResultUrls({ video: { url: "v.mp4" } })).toEqual(["v.mp4"]);
    expect(falResultUrls({})).toEqual([]);
    expect(falResultUrls(null)).toEqual([]);
  });

  it("falErrorMessage falls back to the status code", () => {
    expect(falErrorMessage(503, {})).toBe("fal.ai: HTTP 503");
    expect(falErrorMessage(401, { detail: "nope" })).toBe("fal.ai: nope (HTTP 401)");
  });
});
