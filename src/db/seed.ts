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

// fal.ai models. Endpoint ids, params and prices from fal docs and model pages (checked 2026-10-15):
// https://fal.ai/docs/model-api-reference/ and https://fal.ai/models/<endpoint id>
const negativePrompt: ParamField = { key: "negative_prompt", label: "Негативный промпт", type: "text", maxLength: 1000 };
const seed: ParamField = { key: "seed", label: "Seed", type: "number", integer: true, min: 0 };

export const FAL_MODELS: Seed[] = [
  {
    id: "fal-kling-v3-pro-t2v",
    provider: "fal",
    providerModelId: "fal-ai/kling-video/v3/pro/text-to-video",
    name: "Kling 3.0 Pro (fal)",
    type: "video",
    // $0.112/s audio off, $0.168/s audio on
    priceUnit: "per_second",
    priceUsd: 0.112,
    priceRules: { variants: [{ when: { generate_audio: true }, priceUsd: 0.168 }] },
    paramsSchema: [
      {
        key: "duration",
        label: "Длительность, с",
        type: "select",
        options: Array.from({ length: 13 }, (_, i) => ({ value: String(i + 3) })),
        default: "5",
      },
      {
        key: "aspect_ratio",
        label: "Соотношение сторон",
        type: "select",
        options: [{ value: "16:9" }, { value: "9:16" }, { value: "1:1" }],
        default: "16:9",
      },
      { key: "generate_audio", label: "Звук", type: "boolean", default: true },
      { key: "cfg_scale", label: "CFG (0–1)", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
      negativePrompt,
    ],
  },
  {
    id: "fal-veo31-fast",
    provider: "fal",
    providerModelId: "fal-ai/veo3.1/fast",
    name: "Veo 3.1 Fast (fal)",
    type: "video",
    // $0.10/s, with audio $0.15/s (720p/1080p); 4k $0.30/s, with audio $0.35/s
    priceUnit: "per_second",
    priceUsd: 0.1,
    priceRules: {
      variants: [
        { when: { resolution: "4k", generate_audio: true }, priceUsd: 0.35 },
        { when: { resolution: "4k" }, priceUsd: 0.3 },
        { when: { generate_audio: true }, priceUsd: 0.15 },
      ],
    },
    paramsSchema: [
      { key: "duration", label: "Длительность", type: "select", options: [{ value: "4s" }, { value: "6s" }, { value: "8s" }], default: "8s" },
      { key: "aspect_ratio", label: "Соотношение сторон", type: "select", options: [{ value: "16:9" }, { value: "9:16" }], default: "16:9" },
      {
        key: "resolution",
        label: "Разрешение",
        type: "select",
        options: [{ value: "720p" }, { value: "1080p" }, { value: "4k", label: "4K" }],
        default: "720p",
      },
      { key: "generate_audio", label: "Звук", type: "boolean", default: true },
      negativePrompt,
      seed,
    ],
  },
  {
    id: "fal-nano-banana-pro",
    provider: "fal",
    providerModelId: "fal-ai/nano-banana-pro",
    name: "Nano Banana Pro (fal)",
    type: "image",
    // $0.15/image, 4K x2
    priceUnit: "per_image",
    priceUsd: 0.15,
    priceRules: { multipliers: { resolution: { "4K": 2 } } },
    paramsSchema: [
      {
        key: "aspect_ratio",
        label: "Соотношение сторон",
        type: "select",
        options: ["auto", "21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"].map((value) => ({ value })),
        default: "1:1",
      },
      { key: "resolution", label: "Разрешение", type: "select", options: [{ value: "1K" }, { value: "2K" }, { value: "4K" }], default: "1K" },
      { key: "num_images", label: "Количество", type: "number", min: 1, max: 4, integer: true, default: 1 },
      { key: "output_format", label: "Формат", type: "select", options: [{ value: "png" }, { value: "jpeg" }, { value: "webp" }], default: "png" },
      seed,
    ],
  },
  {
    id: "fal-seedream-v45",
    provider: "fal",
    providerModelId: "fal-ai/bytedance/seedream/v4.5/text-to-image",
    name: "Seedream 4.5 (fal)",
    type: "image",
    // $0.04/image
    priceUnit: "per_image",
    priceUsd: 0.04,
    paramsSchema: [
      {
        key: "image_size",
        label: "Размер",
        type: "select",
        options: [
          { value: "auto_2K", label: "Авто 2K" },
          { value: "auto_4K", label: "Авто 4K" },
          { value: "square_hd", label: "Квадрат HD" },
          { value: "landscape_16_9", label: "16:9" },
          { value: "portrait_16_9", label: "9:16" },
          { value: "landscape_4_3", label: "4:3" },
          { value: "portrait_4_3", label: "3:4" },
        ],
        default: "auto_2K",
      },
      { key: "num_images", label: "Количество", type: "number", min: 1, max: 6, integer: true, default: 1 },
      seed,
    ],
  },
];

export function seedModels(db: Db) {
  db.insert(models).values([...SEED_MODELS, ...FAL_MODELS]).onConflictDoNothing().run();
}
