import type { Model } from "@/db/schema";
import type { ParamValues } from "./params";

/**
 * Token estimate for token-billed video models (BytePlus Seedance):
 * tokens ≈ duration × width × height × fps / 1024, with width × height from the
 * model's resolution/ratio table.
 */
export type TokenRules = {
  fps: number;
  /** dims[resolution][ratio] = [width, height] */
  dims: Record<string, Record<string, [number, number]>>;
  /** Ratio used for the estimate when the real one isn't known up front (e.g. "adaptive"). */
  fallbackRatio: string;
  durationParam?: string;
  resolutionParam?: string;
  ratioParam?: string;
};

/**
 * Optional per-model pricing tweaks (models.price_rules).
 * - variants: unit price overrides for param combinations, first match wins,
 *   e.g. [{ when: { generate_audio: true }, priceUsd: 0.168 }]; otherwise models.price_usd
 * - multipliers: { resolution: { "4K": 2 } } multiplies the price when a param has that value
 * - secondsParam / countParam: which param holds duration / number of images
 * - tokens: how to estimate tokens for per_1m_tokens models
 */
export type PriceRules = {
  variants?: { when: Record<string, string | number | boolean>; priceUsd: number }[];
  multipliers?: Record<string, Record<string, number>>;
  secondsParam?: string;
  countParam?: string;
  tokens?: TokenRules;
};

type PricedModel = Pick<Model, "priceUnit" | "priceUsd" | "priceRules">;

const round = (n: number) => Math.round(n * 10000) / 10000;

/** Price of one unit for these params (variants and multipliers applied). */
export function unitPrice(model: PricedModel, params: ParamValues): number {
  const rules = (model.priceRules ?? {}) as PriceRules;
  const variant = rules.variants?.find((v) => Object.entries(v.when).every(([k, val]) => params[k] === val));
  let price = variant?.priceUsd ?? model.priceUsd;
  for (const [key, table] of Object.entries(rules.multipliers ?? {})) {
    const m = table[String(params[key])];
    if (m !== undefined) price *= m;
  }
  return price;
}

export function estimateTokens(rules: TokenRules, params: ParamValues): number | null {
  const duration = Number(params[rules.durationParam ?? "duration"]);
  const byRatio = rules.dims[String(params[rules.resolutionParam ?? "resolution"])];
  if (!Number.isFinite(duration) || duration <= 0 || !byRatio) return null;
  const dims = byRatio[String(params[rules.ratioParam ?? "ratio"])] ?? byRatio[rules.fallbackRatio];
  if (!dims) return null;
  return Math.round((duration * dims[0] * dims[1] * rules.fps) / 1024);
}

/** Expected cost in USD before running the job, or null when it can't be estimated. */
export function estimateCost(model: PricedModel, params: ParamValues): number | null {
  const rules = (model.priceRules ?? {}) as PriceRules;
  let units: number;
  switch (model.priceUnit) {
    case "per_second": {
      // parseFloat: some APIs encode duration as "8s"
      const s = parseFloat(String(params[rules.secondsParam ?? "duration"]));
      if (!Number.isFinite(s) || s <= 0) return null;
      units = s;
      break;
    }
    case "per_image": {
      const n = Number(params[rules.countParam ?? "num_images"] ?? 1);
      units = Number.isFinite(n) && n > 0 ? n : 1;
      break;
    }
    case "per_generation":
      units = 1;
      break;
    case "per_1m_tokens": {
      const tokens = rules.tokens ? estimateTokens(rules.tokens, params) : null;
      if (tokens === null) return null;
      units = tokens / 1_000_000;
      break;
    }
  }
  return round(unitPrice(model, params) * units);
}

/** Cost from provider-reported usage; null when the model isn't usage-billed or usage is missing. */
export function actualCost(model: PricedModel, params: ParamValues, usage: { tokens?: number } | undefined): number | null {
  if (model.priceUnit !== "per_1m_tokens" || !usage?.tokens) return null;
  return round((unitPrice(model, params) * usage.tokens) / 1_000_000);
}
