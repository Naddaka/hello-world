import { describe, expect, it } from "vitest";
import { FAL_MODELS, SEED_MODELS } from "@/db/seed";
import { validateParams, type ParamField } from "@/lib/params";
import { estimateCost } from "@/lib/pricing";

const all = [...SEED_MODELS, ...FAL_MODELS];

describe("seed catalog", () => {
  it("every model has valid defaults and an estimable price", () => {
    for (const m of all) {
      const v = validateParams(m.paramsSchema as ParamField[], {});
      expect(v.ok, m.id).toBe(true);
      if (!v.ok) continue;
      const cost = estimateCost({ priceUnit: m.priceUnit, priceUsd: m.priceUsd, priceRules: m.priceRules ?? null }, v.params);
      expect(cost, m.id).toBeGreaterThan(0);
    }
  });

  it("fal prices match the published examples", () => {
    const price = (id: string, params: Record<string, unknown>) => {
      const m = all.find((x) => x.id === id)!;
      const v = validateParams(m.paramsSchema as ParamField[], params);
      if (!v.ok) throw new Error(v.error);
      return estimateCost({ priceUnit: m.priceUnit, priceUsd: m.priceUsd, priceRules: m.priceRules ?? null }, v.params);
    };
    // Kling 3.0 Pro: 5 s with audio = 5 × $0.168
    expect(price("fal-kling-v3-pro-t2v", { duration: "5", generate_audio: true })).toBe(0.84);
    expect(price("fal-kling-v3-pro-t2v", { duration: "10", generate_audio: false })).toBe(1.12);
    // Veo 3.1 Fast: "a 5 second video at 1080p with audio on will cost $0.75" (8 s is the closest allowed: 8 × 0.15)
    expect(price("fal-veo31-fast", { duration: "8s", resolution: "1080p", generate_audio: true })).toBe(1.2);
    // Nano Banana Pro: $0.15, 4K double
    expect(price("fal-nano-banana-pro", { num_images: 2 })).toBe(0.3);
    expect(price("fal-nano-banana-pro", { num_images: 1, resolution: "4K" })).toBe(0.3);
    expect(price("fal-seedream-v45", { num_images: 3 })).toBe(0.12);
  });
});
