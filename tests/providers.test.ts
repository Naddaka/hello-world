import { afterEach, describe, expect, it } from "vitest";
import type { Model } from "@/db/schema";
import { getAdapter, isModelAvailable } from "@/providers";

const fal = { provider: "fal", type: "video" } as Model;
const mock = { provider: "mock", type: "video" } as Model;
const env = process.env.PROVIDER_MODE;
afterEach(() => {
  process.env.PROVIDER_MODE = env;
});

describe("PROVIDER_MODE switch", () => {
  it("mock mode: every model goes to the mock adapter, mock models visible", async () => {
    process.env.PROVIDER_MODE = "mock";
    const id = await getAdapter(fal).generate(fal, { prompt: "x", params: {} });
    expect(id).toMatch(/^mock\./);
    expect(isModelAvailable(mock)).toBe(true);
  });

  it("real mode: fal models use the fal adapter, mock models hidden", async () => {
    process.env.PROVIDER_MODE = "real";
    const key = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    await expect(getAdapter(fal).generate(fal, { prompt: "x", params: {} })).rejects.toThrow("FAL_KEY");
    process.env.FAL_KEY = key;
    expect(isModelAvailable(mock)).toBe(false);
    expect(isModelAvailable(fal)).toBe(true);
  });

  it("real mode: unknown provider gives a clear error", () => {
    process.env.PROVIDER_MODE = "real";
    expect(() => getAdapter({ provider: "nope" } as Model)).toThrow("не реализован");
  });
});
