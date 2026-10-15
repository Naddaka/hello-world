import { and, asc, count, eq, isNull, isNotNull } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs, models, type Job, type Model } from "@/db/schema";
import type { ParamValues } from "@/lib/params";
import type { ProviderAdapter } from "@/providers/types";

export type WorkerDeps = {
  db: Db;
  getAdapter: (model: Model) => ProviderAdapter;
  maxConcurrent: number;
  now?: () => Date;
  log?: (msg: string) => void;
};

const MAX_ERROR_LEN = 1000;

export function errorText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > MAX_ERROR_LEN ? s.slice(0, MAX_ERROR_LEN) + "…" : s;
}

function fail(deps: WorkerDeps, id: string, error: string) {
  deps.db
    .update(jobs)
    .set({ status: "failed", error, finishedAt: (deps.now ?? (() => new Date()))() })
    .where(eq(jobs.id, id))
    .run();
}

/**
 * Called once on startup. A job that was claimed but never got a provider id was interrupted
 * between claiming and submitting; we can't know whether the provider received it, so it's
 * failed rather than resubmitted (no risk of paying twice).
 */
export function recoverInterrupted(deps: WorkerDeps) {
  const stuck = deps.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "running"), isNull(jobs.providerJobId)))
    .all();
  for (const { id } of stuck) fail(deps, id, "Задача прервана перезапуском сервера до отправки провайдеру.");
  if (stuck.length) deps.log?.(`recovered ${stuck.length} interrupted job(s)`);
}

/** Ask the provider about every running job. */
async function pollRunning(deps: WorkerDeps) {
  const rows = deps.db
    .select({ job: jobs, model: models })
    .from(jobs)
    .innerJoin(models, eq(models.id, jobs.modelId))
    .where(and(eq(jobs.status, "running"), isNotNull(jobs.providerJobId)))
    .all();

  await Promise.all(
    rows.map(async ({ job, model }) => {
      try {
        const s = await deps.getAdapter(model).getStatus(model, job.providerJobId!);
        const now = (deps.now ?? (() => new Date()))();
        if (s.status === "done") {
          deps.db
            .update(jobs)
            .set({ status: "done", resultUrl: s.resultUrl, finishedAt: now })
            .where(eq(jobs.id, job.id))
            .run();
        } else if (s.status === "failed") {
          fail(deps, job.id, s.error || "Провайдер вернул ошибку без описания.");
        }
      } catch (e) {
        // Transport error: keep the job running and ask again on the next tick.
        deps.log?.(`status check failed for job ${job.id}: ${errorText(e)}`);
      }
    }),
  );
}

/** Send queued jobs to providers, up to the concurrency limit. */
async function startQueued(deps: WorkerDeps) {
  const [{ n: running }] = deps.db.select({ n: count() }).from(jobs).where(eq(jobs.status, "running")).all();
  const slots = deps.maxConcurrent - running;
  if (slots <= 0) return;

  const queued = deps.db
    .select({ job: jobs, model: models })
    .from(jobs)
    .innerJoin(models, eq(models.id, jobs.modelId))
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.createdAt))
    .limit(slots)
    .all();

  await Promise.all(queued.map(({ job, model }) => submit(deps, job, model)));
}

async function submit(deps: WorkerDeps, job: Job, model: Model) {
  // Claim first: if we crash mid-submit, recoverInterrupted() fails it instead of resubmitting.
  deps.db
    .update(jobs)
    .set({ status: "running", startedAt: (deps.now ?? (() => new Date()))() })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")))
    .run();
  try {
    const providerJobId = await deps
      .getAdapter(model)
      .generate(model, { prompt: job.prompt, params: job.params as ParamValues });
    deps.db.update(jobs).set({ providerJobId }).where(eq(jobs.id, job.id)).run();
  } catch (e) {
    fail(deps, job.id, errorText(e));
  }
}

export async function tick(deps: WorkerDeps) {
  await pollRunning(deps);
  await startQueued(deps);
}
