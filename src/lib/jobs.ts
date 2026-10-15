import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { jobs, models, type JobStatus, type Model, type ModelType } from "@/db/schema";
import { validateParams, type ParamField, type ParamValues } from "./params";
import { estimateCost } from "./pricing";
import { kindForPath } from "./storage";

export const PROMPT_MAX = 5000;

export type CreateJobInput = { modelId: unknown; prompt: unknown; params: unknown };
export type CreateJobResult = { ok: true; id: string } | { ok: false; error: string };

export function createJob(db: Db, input: CreateJobInput, isModelAvailable: (m: Model) => boolean): CreateJobResult {
  const model = typeof input.modelId === "string" ? db.select().from(models).where(eq(models.id, input.modelId)).get() : undefined;
  if (!model || !model.enabled || !isModelAvailable(model)) return { ok: false, error: "Модель не найдена или отключена." };

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "Введите промпт." };
  if (prompt.length > PROMPT_MAX) return { ok: false, error: `Промпт длиннее ${PROMPT_MAX} символов.` };

  const raw = input.params && typeof input.params === "object" ? (input.params as Record<string, unknown>) : {};
  const v = validateParams(model.paramsSchema as ParamField[], raw);
  if (!v.ok) return v;

  const id = randomUUID();
  db.insert(jobs)
    .values({ id, modelId: model.id, prompt, params: v.params, costEstimate: estimateCost(model, v.params) })
    .run();
  return { ok: true, id };
}

/** Job as sent to the browser. */
export type JobView = {
  id: string;
  modelId: string;
  modelName: string;
  modelType: ModelType;
  prompt: string;
  params: ParamValues;
  status: JobStatus;
  costEstimate: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  files: JobFileView[];
};

export type JobFileView = { url: string; downloadUrl: string; kind: "video" | "image" | "other" };

export function listJobs(db: Db, limit = 50): JobView[] {
  const rows = db
    .select({ job: jobs, modelName: models.name, modelType: models.type })
    .from(jobs)
    .innerJoin(models, eq(models.id, jobs.modelId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .all();
  return rows.map(({ job, modelName, modelType }) => ({
    id: job.id,
    modelId: job.modelId,
    modelName,
    modelType,
    prompt: job.prompt,
    params: job.params as ParamValues,
    status: job.status,
    costEstimate: job.costEstimate,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    files: (job.resultFiles ?? []).map((f, i) => {
      const url = `/api/jobs/${job.id}/files/${i}`;
      return { url, downloadUrl: `${url}?download`, kind: kindForPath(f) };
    }),
  }));
}
