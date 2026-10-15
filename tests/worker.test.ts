import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { jobs, type Model } from "@/db/schema";
import { createJob } from "@/lib/jobs";
import { createMockAdapter } from "@/providers/mock";
import type { ProviderAdapter } from "@/providers/types";
import { recoverInterrupted, tick } from "@/worker/worker";
import { tempDb } from "./helpers";

let t: ReturnType<typeof tempDb>;
afterEach(() => t?.close());

function setup(adapter: ProviderAdapter, maxConcurrent = 5) {
  t = tempDb();
  return { db: t.db, getAdapter: (_: Model) => adapter, maxConcurrent };
}

function newJob(db: typeof t.db, prompt = "a cat", modelId = "mock-video") {
  const r = createJob(db, { modelId, prompt, params: { duration: 10 } }, () => true);
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
    expect(done.resultUrl).toBe("mock://video");
    expect(done.finishedAt).toBeInstanceOf(Date);
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
    expect(createJob(t.db, { modelId: "nope", prompt: "x", params: {} }, () => true)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "  ", params: {} }, () => true)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "x", params: { duration: 7 } }, () => true)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "x", params: {} }, () => false)).toMatchObject({ ok: false });
    expect(createJob(t.db, { modelId: "mock-video", prompt: "x", params: {} }, () => true)).toMatchObject({ ok: true });
  });
});
