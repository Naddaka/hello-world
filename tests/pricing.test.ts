import { describe, expect, it } from "vitest";
import { BYTEPLUS_MODELS } from "@/db/seed";
import { actualCost, estimateCost } from "@/lib/pricing";

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

describe("estimateCost variants", () => {
  // fal Veo 3.1 Fast: $0.10/s, audio $0.15/s, 4k $0.30/s, 4k + audio $0.35/s
  const veo = {
    priceUnit: "per_second" as const,
    priceUsd: 0.1,
    priceRules: {
      variants: [
        { when: { resolution: "4k", generate_audio: true }, priceUsd: 0.35 },
        { when: { resolution: "4k" }, priceUsd: 0.3 },
        { when: { generate_audio: true }, priceUsd: 0.15 },
      ],
    },
  };

  it("picks the first matching variant and parses '8s' durations", () => {
    expect(estimateCost(veo, { duration: "8s", resolution: "1080p", generate_audio: false })).toBe(0.8);
    expect(estimateCost(veo, { duration: "5s", resolution: "1080p", generate_audio: true })).toBe(0.75);
    expect(estimateCost(veo, { duration: "4s", resolution: "4k", generate_audio: false })).toBe(1.2);
    expect(estimateCost(veo, { duration: "4s", resolution: "4k", generate_audio: true })).toBe(1.4);
  });
});

describe("token pricing (Seedance)", () => {
  const [s25, fast] = BYTEPLUS_MODELS.map((m) => ({ priceUnit: m.priceUnit, priceUsd: m.priceUsd, priceRules: m.priceRules ?? null }));

  it("matches the BytePlus price examples for Seedance 2.5 (16:9, 5 s, no video input)", () => {
    expect(estimateCost(s25, { resolution: "480p", ratio: "16:9", duration: 5 })).toBeCloseTo(0.514, 3);
    expect(estimateCost(s25, { resolution: "720p", ratio: "16:9", duration: 5 })).toBeCloseTo(1.156, 3);
    expect(estimateCost(s25, { resolution: "1080p", ratio: "16:9", duration: 5 })).toBeCloseTo(2.843, 3);
  });

  it("2.0 Fast, adaptive ratio falls back to 16:9 dims, unsupported resolution → null", () => {
    expect(estimateCost(fast, { resolution: "720p", ratio: "16:9", duration: 5 })).toBeCloseTo(0.6048, 4);
    expect(estimateCost(fast, { resolution: "720p", ratio: "adaptive", duration: 5 })).toBeCloseTo(0.6048, 4);
    expect(estimateCost(fast, { resolution: "1080p", ratio: "16:9", duration: 5 })).toBeNull();
  });

  it("actual cost from reported tokens uses the resolution's price", () => {
    expect(actualCost(s25, { resolution: "1080p" }, { tokens: 246840 })).toBeCloseTo(2.8880, 4);
    expect(actualCost(s25, { resolution: "720p" }, { tokens: 108900 })).toBeCloseTo(1.1652, 4);
    expect(actualCost(s25, { resolution: "720p" }, undefined)).toBeNull();
    expect(actualCost({ priceUnit: "per_second", priceUsd: 1, priceRules: null }, {}, { tokens: 5 })).toBeNull();
  });
});
