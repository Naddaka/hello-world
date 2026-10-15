import { describe, expect, it } from "vitest";
import { estimateCost } from "@/lib/pricing";

describe("estimateCost", () => {
  it("per second uses duration and multipliers", () => {
    const m = { priceUnit: "per_second" as const, priceUsd: 0.05, priceRules: { multipliers: { resolution: { "1080p": 2 } } } };
    expect(estimateCost(m, { duration: 10, resolution: "720p" })).toBe(0.5);
    expect(estimateCost(m, { duration: 10, resolution: "1080p" })).toBe(1);
    expect(estimateCost(m, {})).toBeNull();
  });

  it("per image uses num_images, default 1", () => {
    const m = { priceUnit: "per_image" as const, priceUsd: 0.02, priceRules: null };
    expect(estimateCost(m, { num_images: 3 })).toBe(0.06);
    expect(estimateCost(m, {})).toBe(0.02);
  });

  it("per generation is flat", () => {
    expect(estimateCost({ priceUnit: "per_generation", priceUsd: 0.4, priceRules: null }, { duration: 99 })).toBe(0.4);
  });
});
