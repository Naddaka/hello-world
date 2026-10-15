import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kindForPath, parseRange, resolveResultPath, saveResult } from "@/lib/storage";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "genhub-st-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const fakeFetch = (body: BodyInit, init: ResponseInit) => (async () => new Response(body, init)) as unknown as typeof fetch;

describe("saveResult", () => {
  it("copies bundled mock samples", async () => {
    const rel = await saveResult(dir, "mock://video", "job1", 0);
    expect(rel).toBe("results/job1/0.mp4");
    expect(fs.statSync(path.join(dir, rel)).size).toBeGreaterThan(1000);
    expect(await saveResult(dir, "mock://image", "job1", 1)).toBe("results/job1/1.png");
  });

  it("decodes data URIs", async () => {
    const rel = await saveResult(dir, "data:image/jpeg;base64," + Buffer.from("JPEGDATA").toString("base64"), "j", 0);
    expect(rel).toBe("results/j/0.jpg");
    expect(fs.readFileSync(path.join(dir, rel), "utf8")).toBe("JPEGDATA");
  });

  it("downloads over http, extension from content-type, then from URL", async () => {
    const a = await saveResult(dir, "https://cdn/x", "j", 0, { fetch: fakeFetch("VIDEO", { headers: { "content-type": "video/mp4" } }) });
    expect(a).toBe("results/j/0.mp4");
    expect(fs.readFileSync(path.join(dir, a), "utf8")).toBe("VIDEO");
    const b = await saveResult(dir, "https://cdn/out.webp?sig=1", "j", 1, {
      fetch: fakeFetch("IMG", { headers: { "content-type": "application/octet-stream" } }),
    });
    expect(b).toBe("results/j/1.webp");
  });

  it("fails on HTTP errors and oversized files without leaving partial files", async () => {
    await expect(saveResult(dir, "https://cdn/x.mp4", "j", 0, { fetch: fakeFetch("no", { status: 403 }) })).rejects.toThrow("HTTP 403");
    await expect(
      saveResult(dir, "https://cdn/x.mp4", "j", 0, { fetch: fakeFetch("x".repeat(100), {}), maxBytes: 10 }),
    ).rejects.toThrow("слишком большой");
    expect(fs.readdirSync(path.join(dir, "results/j"))).toEqual([]);
  });

  it("rejects unsafe job ids and unsupported schemes", async () => {
    await expect(saveResult(dir, "mock://video", "../etc", 0)).rejects.toThrow();
    await expect(saveResult(dir, "file:///etc/passwd", "j", 0)).rejects.toThrow();
  });
});

describe("helpers", () => {
  it("resolveResultPath stays inside DATA_DIR/results", () => {
    expect(resolveResultPath(dir, "results/j/0.mp4")).toBe(path.join(dir, "results/j/0.mp4"));
    expect(resolveResultPath(dir, "results/../app.db")).toBeNull();
    expect(resolveResultPath(dir, "/etc/passwd")).toBeNull();
  });

  it("parseRange", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=200-", 100)).toBe("invalid");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });

  it("kindForPath", () => {
    expect(kindForPath("a/0.mp4")).toBe("video");
    expect(kindForPath("a/0.JPG")).toBe("image");
    expect(kindForPath("a/0.bin")).toBe("other");
  });
});
