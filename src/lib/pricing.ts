import type { Model } from "@/db/schema";
import type { ParamValues } from "./params";

/**
 * Optional per-model pricing tweaks (models.price_rules).
 * - variants: unit price overrides for param combinations, first match wins,
 *   e.g. [{ when: { generate_audio: true }, priceUsd: 0.168 }]; otherwise models.price_usd
 * - multipliers: { resolution: { "4K": 2 } } multiplies the price when a param has that value
 * - secondsParam / countParam: which param holds duration / number of images
 */
export type PriceRules = {
  variants?: { when: Record<string, string | number | boolean>; priceUsd: number }[];
  multipliers?: Record<string, Record<string, number>>;
  secondsParam?: string;
  countParam?: string;
};

const round = (n: number) => Math.round(n * 10000) / 10000;

/** Expected cost in USD before running the job, or null when it can't be estimated. */
export function estimateCost(model: Pick<Model, "priceUnit" | "priceUsd" | "priceRules">, params: ParamValues): number | null {
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
    case "per_1m_tokens":
      // Token-based pricing needs a provider-specific token estimate (added with the Seedance adapter).
      return null;
  }
  const variant = rules.variants?.find((v) => Object.entries(v.when).every(([k, val]) => params[k] === val));
  let price = (variant?.priceUsd ?? model.priceUsd) * units;
  for (const [key, table] of Object.entries(rules.multipliers ?? {})) {
    const m = table[String(params[key])];
    if (m !== undefined) price *= m;
  }
  return round(price);
}
