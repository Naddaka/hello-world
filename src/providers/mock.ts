import type { Model } from "@/db/schema";
import type { GenerateInput, ProviderAdapter, ProviderStatus } from "./types";

export type MockOptions = { minMs?: number; maxMs?: number; now?: () => number };

/** Prompts containing this word make the mock job fail, to test error handling. */
export const MOCK_FAIL_WORD = "fail";

/**
 * Fake provider: no network. The job's whole state is encoded in its id, so mock jobs
 * survive a server restart just like real ones.
 */
export function createMockAdapter(opts: MockOptions = {}): ProviderAdapter {
  const minMs = opts.minMs ?? 5000;
  const maxMs = opts.maxMs ?? 15000;
  const now = opts.now ?? Date.now;

  return {
    async generate(model: Model, input: GenerateInput) {
      const duration = Math.round(minMs + Math.random() * (maxMs - minMs));
      const fail = input.prompt.toLowerCase().includes(MOCK_FAIL_WORD) ? 1 : 0;
      const count = model.type === "image" ? Math.max(1, Number(input.params.num_images) || 1) : 1;
      return ["mock", model.type, now(), duration, fail, count].join(".");
    },

    async getStatus(_model: Model, providerJobId: string): Promise<ProviderStatus> {
      const [prefix, type, start, duration, fail, count = "1"] = providerJobId.split(".");
      if (prefix !== "mock" || !start || !duration) throw new Error(`Неизвестный mock id: ${providerJobId}`);
      const elapsed = now() - Number(start);
      if (elapsed < Math.min(1500, Number(duration) / 3)) return { status: "queued" };
      if (elapsed < Number(duration)) return { status: "running" };
      if (fail === "1") return { status: "failed", error: "Mock: провайдер отклонил запрос (тестовая ошибка)." };
      return { status: "done", resultUrls: Array.from({ length: Number(count) }, () => `mock://${type}`) };
    },
  };
}
