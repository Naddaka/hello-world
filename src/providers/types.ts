import type { Model } from "@/db/schema";
import type { ParamValues } from "@/lib/params";

export type ProviderStatus =
  | { status: "queued" | "running" }
  /** One URL per output file (several images per job are possible). */
  | { status: "done"; resultUrls: string[] }
  | { status: "failed"; error: string };

export type GenerateInput = { prompt: string; params: ParamValues };

/**
 * One adapter per provider. A new provider = one new file implementing this interface,
 * registered in providers/index.ts.
 */
export interface ProviderAdapter {
  /** Submit a generation; returns the provider's job id. Throws on submit errors. */
  generate(model: Model, input: GenerateInput): Promise<string>;
  /** Current state of a submitted job. Throws on transport errors (the job stays running). */
  getStatus(model: Model, providerJobId: string): Promise<ProviderStatus>;
}
