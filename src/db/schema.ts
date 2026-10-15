import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const MODEL_TYPES = ["video", "image"] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

/** How the provider bills a generation. `price_usd` is the price of one unit. */
export const PRICE_UNITS = ["per_second", "per_image", "per_generation", "per_1m_tokens"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Model catalog. Rows are data, not code: prices and params are edited without a release. */
export const models = sqliteTable("models", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  /** Model identifier on the provider side, e.g. a fal endpoint id. */
  providerModelId: text("provider_model_id").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: MODEL_TYPES }).notNull(),
  priceUnit: text("price_unit", { enum: PRICE_UNITS }).notNull(),
  priceUsd: real("price_usd").notNull(),
  /** Optional price modifiers depending on params (e.g. resolution), JSON. */
  priceRules: text("price_rules", { mode: "json" }),
  /** Form fields for this model, JSON. */
  paramsSchema: text("params_schema", { mode: "json" }).notNull().default(sql`'[]'`),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
});

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    prompt: text("prompt").notNull(),
    params: text("params", { mode: "json" }).notNull().default(sql`'{}'`),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    providerJobId: text("provider_job_id"),
    /** Result URLs as returned by the provider (short-lived), JSON array. */
    resultUrls: text("result_urls", { mode: "json" }).$type<string[]>(),
    /** Main result file, path relative to DATA_DIR. */
    resultPath: text("result_path"),
    /** All result files (several images per job), paths relative to DATA_DIR, JSON array. */
    resultFiles: text("result_files", { mode: "json" }).$type<string[]>(),
    /** Failed attempts to download the result from the provider. */
    downloadAttempts: integer("download_attempts").notNull().default(0),
    costEstimate: real("cost_estimate"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    /** When the worker picked the job up and sent it to the provider. */
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("jobs_status_idx").on(t.status), index("jobs_created_at_idx").on(t.createdAt)],
);

export type Model = typeof models.$inferSelect;
export type Job = typeof jobs.$inferSelect;
