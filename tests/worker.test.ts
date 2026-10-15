import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { jobs, type Model } from "@/db/schema";
import fs from "node:fs";
import path from "node:path";
import { createJob, listJobs } from "@/lib/jobs";
import { saveResult } from "@/lib/storage";
import { createMockAdapter } from "@/providers/mock";
import type { ProviderAdapter } from "@/providers/types";
import { MAX_DOWNLOAD_ATTEMPTS, recoverInterrupted, tick, type WorkerDeps } from "@/worker/worker";
import { tempDb } from "./helpers";

let t: ReturnType<typeof tempDb>;
const OPTS = { isModelAvailable: () => true, uploadExists: () => true };
afterEach(() => t?.close());

function setup(adapter: ProviderAdapter, maxConcurrent = 5, save?: WorkerDeps["saveResult"]): WorkerDeps {
  t = tempDb();
  const dir = t.dir;
  return {
    db: t.db,
    getAdapter: (_: Model) => adapter,
    maxConcurrent,
    saveResult: save ?? ((url, jobId, i) => saveResult(dir, url, jobId, i)),
  };
}

function newJob(db: typeof t.db, prompt = "a cat", modelId = "mock-video") {
  const r = createJob(db, { modelId, prompt, params: { duration: 10 } }, OPTS);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

const status = (db: typeof t.db, id: string) => db.select().from(jobs).where(eq(jobs.id, id)).get()!;

describe("job lifecycle (mock)", () => {
  it("queued → running → done", async () => {
    let now = 1_000_000;
    const deps = setup(createMockAdapter({ minMs: 5000, maxMs: 5000, now: () => now }));
    const id = newJob(deps.db);
    expect(status(deps.db, id).status).toBe("queued");
    expect(status(deps.db, id).costEstimate).toBe(0.5);

    await tick(deps);
    const running = status(deps.db, id);
    expect(running.status).toBe("running");
    expect(running.providerJobId).toMatch(/^mock\.video\./);
    expect(running.startedAt).toBeInstanceOf(Date);

    now += 3000;
    await tick(deps);
    expect(status(deps.db, id).status).toBe("running");

    now += 3000;
    await tick(deps);
    const done = status(deps.db, id);
    expect(done.status).toBe("done");
    expect(done.resultUrls).toEqual(["mock://video"]);
    expect(done.resultPath).toBe(`results/${id}/0.mp4`);
    expect(fs.existsSync(path.join(t.dir, done.resultPath!))).toBe(true);
    expect(done.finishedAt).toBeInstanceOf(Date);
    expect(listJobs(deps.db)[0].files).toEqual([
      { url: `/api/jobs/${id}/files/0`, downloadUrl: `/api/jobs/${id}/files/0?download`, kind: "video" },
    ]);
  });

  it("stores every image of a multi-image job", async () => {
    let now = 0;
    const deps = setup(createMockAdapter({ minMs: 10, maxMs: 10, now: () => now }));
    const r = createJob(deps.db, { modelId: "mock-image", prompt: "x", params: { num_images: 3 } }, OPTS);
    if (!r.ok) throw new Error(r.error);
    await tick(deps);
    now += 100;
    await tick(deps);
    expect(status(deps.db, r.id).resultFiles).toEqual([0, 1, 2].map((i) => `results/${r.id}/${i}.png`));
  });

  it("retries a failed download, then fails the job with a clear message", async () => {
    let calls = 0;
    const deps = setup({ generate: async () => "p", getStatus: async () => ({ status: "done", resultUrls: ["https://x/y.mp4"] }) }, 5, async () => {
      calls++;
      throw new Error("HTTP 503");
    });
    const id = newJob(deps.db);
    await tick(deps); // submit
    for (let i = 0; i < MAX_DOWNLOAD_ATTEMPTS - 1; i++) {
      await tick(deps);
      expect(status(deps.db, id).status).toBe("running");
    }
    await tick(deps);
    expect(calls).toBe(MAX_DOWNLOAD_ATTEMPTS);
    expect(status(deps.db, id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("не удалось скачать"),
      resultUrls: ["https://x/y.mp4"],
    });
  });

  it("stores the actual cost from provider token usage", async () => {
    const deps = setup({
      generate: async () => "cgt",
      getStatus: async () => ({ status: "done", resultUrls: ["mock://video"], usage: { tokens: 108_000 } }),
    });
    const r = createJob(deps.db, { modelId: "byteplus-seedance-2-5", prompt: "x", params: { resolution: "720p", duration: 5 } }, OPTS);
    if (!r.ok) throw new Error(r.error);
    expect(status(deps.db, r.id).costEstimate).toBeCloseTo(1.1556, 4);
    await tick(deps);
    await tick(deps);
    expect(status(deps.db, r.id)).toMatchObject({ status: "done", costActual: 1.1556 });
  });

  it("a download that recovers on retry ends done", async () => {
    let calls = 0;
    const deps = setup({ generate: async () => "p", getStatus: async () => ({ status: "done", resultUrls: ["https://x/y.png"] }) }, 5, async (_u, jobId) => {
      if (++calls === 1) throw new Error("ECONNRESET");
      return `results/${jobId}/0.png`;
    });
    const id = newJob(deps.db);
    await tick(deps);
    await tick(deps);
    await tick(deps);
    expect(status(deps.db, id)).toMatchObject({ status: "done", downloadAttempts: 1 });
  });

  it("provider failure → failed with message", async () => {
    let now = 0;
    const deps = setup(createMockAdapter({ minMs: 10, maxMs: 10, now: () => now }));
    const id = newJob(deps.db, "please fail");
    await tick(deps);
    now += 100;
    await tick(deps);
    expect(status(deps.db, id)).toMatchObject({ status: "failed", error: expect.stringContaining("тестовая ошибка") });
  });

  it("submit exception → failed, app keeps going", async () => {
    const deps = setup({
      generate: async () => {
        throw new Error("HTTP 422: bad prompt");
      },
      getStatus: async () => ({ status: "running" }),
    });
    const id = newJob(deps.db);
    await tick(deps);
    expect(status(deps.db, id)).toMatchObject({ status: "failed", error: "HTTP 422: bad prompt" });
  });

  it("status-check exception keeps the job running", async () => {
    const deps = setup({
      generate: async () => "p1",
      getStatus: async () => {
        throw new Error("ECONNRESET");
      },
    });
    const id = newJob(deps.db);
    await tick(deps);
    await tick(deps);
    expect(status(deps.db, id).status).toBe("running");
  });

  it("respects the concurrency limit", async () => {
    const deps = setup({ generate: async () => "p", getStatus: async () => ({ status: "running" }) }, 2);
    const ids = [newJob(deps.db), newJob(deps.db), newJob(deps.db)];
    await tick(deps);
    await tick(deps);
    expect(ids.map((id) => status(deps.db, id).status)).toEqual(["running", "running", "queued"]);
  });

  it("fails jobs interrupted between claim and submit", () => {
    const deps = setup(createMockAdapter());
    const id = newJob(deps.db);
    deps.db.update(jobs).set({ status: "running" }).where(eq(jobs.id, id)).run();
    recoverInterrupted(deps);
    expect(status(deps.db, id)).toMatchObject({ status: "failed", error: expect.stringContaining("перезапуском") });
  });
});

describe("createJob", () => {
  it("validates model, prompt and params", () => {
    t = tempDb();
    expect(createJob(t.db, { modelId: "nope", prompt: "x", params: {} }, OPTS)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "  ", params: {} }, OPTS)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "x", params: { duration: 7 } }, OPTS)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "x", params: {} }, { ...OPTS, isModelAvailable: () => false })).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "x", params: {} }, OPTS)).toMatchObject({ ok: true });
  });
});
