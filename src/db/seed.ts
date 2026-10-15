import type { Db } from "./index";
import { models } from "./schema";
import type { ParamField } from "@/lib/params";
import type { PriceRules } from "@/lib/pricing";

type Seed = typeof models.$inferInsert & { paramsSchema: ParamField[]; priceRules?: PriceRules | null };

const aspect: ParamField = {
  key: "aspect_ratio",
  label: "Соотношение сторон",
  type: "select",
  options: [{ value: "16:9" }, { value: "9:16" }, { value: "1:1" }],
  default: "16:9",
};

/**
 * Initial catalog. Inserted only if missing: prices and params edited in the DB are never
 * overwritten by a restart or a release.
 */
export const SEED_MODELS: Seed[] = [
  {
    id: "mock-video",
    provider: "mock",
    providerModelId: "mock-video",
    name: "Тестовое видео (mock)",
    type: "video",
    priceUnit: "per_second",
    priceUsd: 0.05,
    priceRules: { multipliers: { resolution: { "1080p": 2 } } },
    paramsSchema: [
      { key: "duration", label: "Длительность, с", type: "select", options: [{ value: 5 }, { value: 10 }], default: 5 },
      aspect,
      { key: "resolution", label: "Разрешение", type: "select", options: [{ value: "720p" }, { value: "1080p" }], default: "720p" },
    ],
  },
  {
    id: "mock-image",
    provider: "mock",
    providerModelId: "mock-image",
    name: "Тестовое изображение (mock)",
    type: "image",
    priceUnit: "per_image",
    priceUsd: 0.02,
    paramsSchema: [
      aspect,
      { key: "num_images", label: "Количество", type: "number", min: 1, max: 4, integer: true, default: 1 },
    ],
  },
];

export function seedModels(db: Db) {
  db.insert(models).values(SEED_MODELS).onConflictDoNothing().run();
}
