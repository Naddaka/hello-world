import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { models, type ModelType, type PriceUnit } from "@/db/schema";
import { isModelAvailable } from "@/providers";
import type { ParamField } from "./params";
import type { PriceRules } from "./pricing";

/** Model as sent to the browser. */
export type ModelView = {
  id: string;
  name: string;
  provider: string;
  type: ModelType;
  priceUnit: PriceUnit;
  priceUsd: number;
  priceRules: PriceRules | null;
  paramsSchema: ParamField[];
};

export function listAvailableModels(db: Db): ModelView[] {
  return db
    .select()
    .from(models)
    .where(eq(models.enabled, true))
    .orderBy(desc(models.type), asc(models.name)) // video first
    .all()
    .filter(isModelAvailable)
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      type: m.type,
      priceUnit: m.priceUnit,
      priceUsd: m.priceUsd,
      priceRules: (m.priceRules as PriceRules | null) ?? null,
      paramsSchema: m.paramsSchema as ParamField[],
    }));
}
