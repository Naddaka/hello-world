import type { Model } from "@/db/schema";
import { config } from "@/lib/config";
import { createMockAdapter } from "./mock";
import type { ProviderAdapter } from "./types";

const mock = createMockAdapter({
  minMs: Number(process.env.MOCK_MIN_MS) || undefined,
  maxMs: Number(process.env.MOCK_MAX_MS) || undefined,
});

/** Real adapters by models.provider. */
const adapters: Record<string, ProviderAdapter> = {};

/** In mock mode every model goes to the mock adapter. */
export function getAdapter(model: Model): ProviderAdapter {
  if (config.providerMode === "mock" || model.provider === "mock") return mock;
  const a = adapters[model.provider];
  if (!a) throw new Error(`Адаптер для провайдера «${model.provider}» не реализован.`);
  return a;
}

/** Mock-only demo models are hidden when real providers are on. */
export function isModelAvailable(model: Model): boolean {
  return config.providerMode === "mock" || model.provider !== "mock";
}
