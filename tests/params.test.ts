import { describe, expect, it } from "vitest";
import { validateParams, type ParamField } from "@/lib/params";

const schema: ParamField[] = [
  { key: "duration", label: "Длительность", type: "select", options: [{ value: 5 }, { value: 10 }], default: 5 },
  { key: "n", label: "Количество", type: "number", min: 1, max: 4, integer: true, default: 1 },
  { key: "audio", label: "Звук", type: "boolean", default: false },
  { key: "neg", label: "Негатив", type: "text", maxLength: 5 },
  { key: "seed", label: "Seed", type: "number", required: true },
];

describe("validateParams", () => {
  it("fills defaults, coerces types, drops unknown keys", () => {
    const r = validateParams(schema, { duration: "10", seed: "42", audio: "on", junk: 1 });
    expect(r).toEqual({ ok: true, params: { duration: 10, n: 1, audio: true, seed: 42 } });
  });

  it("rejects bad values with a readable message", () => {
    expect(validateParams(schema, { seed: 1, duration: 7 })).toMatchObject({ ok: false, error: expect.stringContaining("Длительность") });
    expect(validateParams(schema, { seed: 1, n: 5 })).toMatchObject({ ok: false, error: expect.stringContaining("максимум 4") });
    expect(validateParams(schema, { seed: 1, n: 1.5 })).toMatchObject({ ok: false });
    expect(validateParams(schema, { seed: "x" })).toMatchObject({ ok: false });
    expect(validateParams(schema, { seed: 1, neg: "toolong" })).toMatchObject({ ok: false });
    expect(validateParams(schema, {})).toMatchObject({ ok: false, error: expect.stringContaining("Seed") });
  });
});
