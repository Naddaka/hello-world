import { and, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs, models, type JobStatus } from "@/db/schema";

// Accounting rules (approximate by design):
// - done:    actual cost reported by the provider, else the catalog estimate
// - failed:  $0, unless the provider reported usage (then that)
// - queued / running: not spent yet, but their estimate is "reserved" for the budget check
// A job counts towards the month it was created in, in APP_TIMEZONE.

type CostFields = { status: JobStatus; costEstimate: number | null; costActual: number | null };

export function spentCost(j: CostFields): number {
  if (j.status === "done") return j.costActual ?? j.costEstimate ?? 0;
  if (j.status === "failed") return j.costActual ?? 0;
  return 0;
}

export function reservedCost(j: CostFields): number {
  return j.status === "queued" || j.status === "running" ? (j.costEstimate ?? 0) : 0;
}

/** UTC offset of a time zone at an instant, in ms (e.g. Kyiv in summer: +3h). */
function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of local midnight on the 1st of (year, month0) in timeZone. DST-safe. */
function monthStart(timeZone: string, year: number, month0: number): Date {
  const naive = Date.UTC(year, month0, 1);
  let t = naive - tzOffsetMs(timeZone, new Date(naive));
  t = naive - tzOffsetMs(timeZone, new Date(t)); // second pass settles DST edges
  return new Date(t);
}

export type MonthRange = { key: string; start: Date; end: Date; label: string };

/** "YYYY-MM" of an instant in timeZone. */
export function monthKey(timeZone: string, at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}`;
}

/** Month range for a "YYYY-MM" key (or the current month when the key is missing/invalid). */
export function monthRange(timeZone: string, key: string | undefined, now = new Date()): MonthRange {
  const k = key && /^\d{4}-(0[1-9]|1[0-2])$/.test(key) ? key : monthKey(timeZone, now);
  const [y, m] = k.split("-").map(Number);
  const start = monthStart(timeZone, y, m - 1);
  const end = monthStart(timeZone, m === 12 ? y + 1 : y, m === 12 ? 0 : m);
  const label = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 15)));
  return { key: k, start, end, label: label.replace(/\s*г\.$/, "") };
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type Breakdown = { id: string; name: string; count: number; total: number; avg: number };

export type MonthSummary = {
  range: MonthRange;
  total: number;
  reserved: number;
  doneCount: number;
  failedCount: number;
  activeCount: number;
  /** Average cost of a successful generation. */
  avgDone: number | null;
  byModel: (Breakdown & { provider: string })[];
  byProvider: Breakdown[];
};

const round = (n: number) => Math.round(n * 10000) / 10000;

export function monthSummary(db: Db, range: MonthRange): MonthSummary {
  const rows = db
    .select({
      status: jobs.status,
      costEstimate: jobs.costEstimate,
      costActual: jobs.costActual,
      modelId: models.id,
      modelName: models.name,
      provider: models.provider,
    })
    .from(jobs)
    .innerJoin(models, eq(models.id, jobs.modelId))
    .where(and(gte(jobs.createdAt, range.start), lt(jobs.createdAt, range.end)))
    .all();

  let total = 0;
  let reserved = 0;
  let doneTotal = 0;
  const counts: Record<JobStatus, number> = { queued: 0, running: 0, done: 0, failed: 0 };
  const byModel = new Map<string, Breakdown & { provider: string; doneCount: number }>();
  const byProvider = new Map<string, Breakdown & { doneCount: number }>();

  for (const r of rows) {
    counts[r.status]++;
    const cost = spentCost(r);
    total += cost;
    reserved += reservedCost(r);
    if (r.status === "done") doneTotal += cost;
    if (r.status !== "done" && cost === 0) continue; // only paid generations go into breakdowns
    const m = byModel.get(r.modelId) ?? { id: r.modelId, name: r.modelName, provider: r.provider, count: 0, total: 0, avg: 0, doneCount: 0 };
    const p = byProvider.get(r.provider) ?? { id: r.provider, name: r.provider, count: 0, total: 0, avg: 0, doneCount: 0 };
    for (const b of [m, p]) {
      b.count++;
      b.total += cost;
    }
    byModel.set(r.modelId, m);
    byProvider.set(r.provider, p);
  }

  const finish = <T extends Breakdown>(xs: T[]) =>
    xs
      .map((b) => ({ ...b, total: round(b.total), avg: b.count ? round(b.total / b.count) : 0 }))
      .sort((a, b) => b.total - a.total);

  return {
    range,
    total: round(total),
    reserved: round(reserved),
    doneCount: counts.done,
    failedCount: counts.failed,
    activeCount: counts.queued + counts.running,
    avgDone: counts.done ? round(doneTotal / counts.done) : null,
    byModel: finish([...byModel.values()]).map(({ doneCount: _, ...b }) => b),
    byProvider: finish([...byProvider.values()]).map(({ doneCount: _, ...b }) => b),
  };
}

export type BudgetState = { budget: number; spent: number; reserved: number; remaining: number };

/** Spend of the current month plus in-flight reservations (all active jobs, whatever their month). */
export function budgetState(db: Db, timeZone: string, budget: number, now = new Date()): BudgetState {
  const range = monthRange(timeZone, undefined, now);
  const spent = monthSummary(db, range).total;
  const active = db
    .select({ status: jobs.status, costEstimate: jobs.costEstimate, costActual: jobs.costActual })
    .from(jobs)
    .where(inArray(jobs.status, ["queued", "running"]))
    .all();
  const reserved = round(active.reduce((s, j) => s + reservedCost(j), 0));
  return { budget, spent, reserved, remaining: round(budget - spent - reserved) };
}

/**
 * Block a new generation when spent + reserved + its estimate would exceed the budget.
 * Returns an error message, or null when the job may run.
 */
export function budgetError(state: BudgetState, estimate: number | null): string | null {
  const need = estimate ?? 0;
  if (state.spent + state.reserved + need <= state.budget + 1e-9) return null;
  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const parts = [`потрачено ${fmt(state.spent)}`];
  if (state.reserved > 0) parts.push(`в работе ${fmt(state.reserved)}`);
  parts.push(`эта генерация ≈ ${fmt(need)}`);
  return `Месячный лимит ${fmt(state.budget)} будет превышен: ${parts.join(", ")}. Лимит задаётся MONTHLY_BUDGET_USD.`;
}
