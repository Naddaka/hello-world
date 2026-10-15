import { afterEach, describe, expect, it } from "vitest";
import { jobs } from "@/db/schema";
import { plural } from "@/lib/format";
import { createJob } from "@/lib/jobs";
import { budgetError, budgetState, monthKey, monthRange, monthSummary, reservedCost, shiftMonth, spentCost } from "@/lib/spending";
import { tempDb } from "./helpers";

const KYIV = "Europe/Kyiv";
let t: ReturnType<typeof tempDb>;
afterEach(() => t?.close());

describe("month boundaries in Kyiv", () => {
  it("October 2026: starts at UTC+3 (summer), ends at UTC+2 (after the Oct 25 DST switch)", () => {
    const r = monthRange(KYIV, "2026-10");
    expect(r.start.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(r.label).toBe("октябрь 2026");
  });

  it("December rolls over into January, invalid keys fall back to the current month", () => {
    const r = monthRange(KYIV, "2026-12");
    expect(r.end.toISOString()).toBe("2026-12-31T22:00:00.000Z");
    const now = new Date("2026-10-31T22:30:00Z"); // already Nov 1, 00:30 in Kyiv
    expect(monthRange(KYIV, "garbage", now).key).toBe("2026-11");
    expect(monthKey(KYIV, now)).toBe("2026-11");
  });

  it("shiftMonth", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("cost rules", () => {
  it("done uses actual, else estimate; failed is free unless usage reported; active is reserved", () => {
    expect(spentCost({ status: "done", costEstimate: 1, costActual: 0.8 })).toBe(0.8);
    expect(spentCost({ status: "done", costEstimate: 1, costActual: null })).toBe(1);
    expect(spentCost({ status: "failed", costEstimate: 1, costActual: null })).toBe(0);
    expect(spentCost({ status: "failed", costEstimate: 1, costActual: 0.3 })).toBe(0.3);
    expect(spentCost({ status: "running", costEstimate: 1, costActual: null })).toBe(0);
    expect(reservedCost({ status: "queued", costEstimate: 1, costActual: null })).toBe(1);
    expect(reservedCost({ status: "done", costEstimate: 1, costActual: null })).toBe(0);
  });
});

function addJob(db: typeof t.db, v: Partial<typeof jobs.$inferInsert> & { modelId: string; createdAt: Date }) {
  db.insert(jobs).values({ id: crypto.randomUUID(), prompt: "x", status: "done", ...v }).run();
}

describe("monthSummary", () => {
  it("totals, averages and breakdowns for the month only", () => {
    t = tempDb();
    const oct = new Date("2026-10-10T12:00:00Z");
    addJob(t.db, { modelId: "fal-kling-v3-pro-t2v", createdAt: oct, costEstimate: 1.68 });
    addJob(t.db, { modelId: "fal-kling-v3-pro-t2v", createdAt: oct, costEstimate: 0.84 });
    addJob(t.db, { modelId: "byteplus-seedance-2-5", createdAt: oct, costEstimate: 1.2, costActual: 1.1556 });
    addJob(t.db, { modelId: "fal-seedream-v45", createdAt: oct, status: "failed", costEstimate: 0.04 });
    addJob(t.db, { modelId: "fal-seedream-v45", createdAt: oct, status: "running", costEstimate: 0.04 });
    // Sep 30, 22:00 UTC = Oct 1, 01:00 in Kyiv → October
    addJob(t.db, { modelId: "fal-nano-banana-pro", createdAt: new Date("2026-09-30T22:00:00Z"), costEstimate: 0.15 });
    // Sep 30, 20:00 UTC = 23:00 in Kyiv → September, excluded
    addJob(t.db, { modelId: "fal-nano-banana-pro", createdAt: new Date("2026-09-30T20:00:00Z"), costEstimate: 100 });

    const s = monthSummary(t.db, monthRange(KYIV, "2026-10"));
    expect(s.total).toBeCloseTo(1.68 + 0.84 + 1.1556 + 0.15, 4);
    expect(s).toMatchObject({ doneCount: 4, failedCount: 1, activeCount: 1, reserved: 0.04 });
    expect(s.avgDone).toBeCloseTo(s.total / 4, 4);
    expect(s.byModel[0]).toMatchObject({ id: "fal-kling-v3-pro-t2v", count: 2, total: 2.52, avg: 1.26, provider: "fal" });
    expect(s.byModel.find((m) => m.id === "fal-seedream-v45")).toBeUndefined(); // failed + running are not paid
    expect(s.byProvider.map((p) => [p.id, p.count])).toEqual([
      ["fal", 3],
      ["byteplus", 1],
    ]);
  });
});

describe("monthly budget", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("blocks when spent + reserved + estimate exceeds the limit", () => {
    t = tempDb();
    addJob(t.db, { modelId: "mock-video", createdAt: now, costEstimate: 7 });
    addJob(t.db, { modelId: "mock-video", createdAt: now, status: "running", costEstimate: 2 });
    const st = budgetState(t.db, KYIV, 10, now);
    expect(st).toEqual({ budget: 10, spent: 7, reserved: 2, remaining: 1 });
    expect(budgetError(st, 1)).toBeNull(); // exactly at the limit is allowed
    expect(budgetError(st, 1.01)).toMatch(/Месячный лимит \$10\.00 будет превышен: потрачено \$7\.00, в работе \$2\.00, эта генерация ≈ \$1\.01/);
  });

  it("an exhausted budget blocks everything, last month's spend doesn't count", () => {
    t = tempDb();
    addJob(t.db, { modelId: "mock-video", createdAt: new Date("2026-09-20T12:00:00Z"), costEstimate: 50 });
    expect(budgetError(budgetState(t.db, KYIV, 10, now), 0.5)).toBeNull();
    addJob(t.db, { modelId: "mock-video", createdAt: now, costEstimate: 10 });
    expect(budgetError(budgetState(t.db, KYIV, 10, now), 0.01)).not.toBeNull();
  });

  it("createJob refuses over-budget jobs and creates nothing", () => {
    t = tempDb();
    const r = createJob(
      t.db,
      { modelId: "mock-video", prompt: "x", params: { duration: 10 } },
      { isModelAvailable: () => true, uploadExists: () => true, checkBudget: (e) => (e! > 0.4 ? "лимит" : null) },
    );
    expect(r).toEqual({ ok: false, error: "лимит", code: "budget" });
    expect(t.db.select().from(jobs).all()).toHaveLength(0);
  });
});


describe("plural", () => {
  it("handles Russian forms", () => {
    const f: [string, string, string] = ["задача", "задачи", "задач"];
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, f))).toEqual(["задача", "задачи", "задач", "задач", "задач", "задача", "задачи", "задач", "задач"]);
  });
});
