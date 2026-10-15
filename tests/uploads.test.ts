import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateParams } from "@/lib/params";
import { detectImageType, isUploadId, readUploadAsDataUri, saveUpload, uploadExists, MAX_UPLOAD_BYTES } from "@/lib/uploads";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "genhub-up-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const PNG = fs.readFileSync(path.join(process.cwd(), "assets/mock/sample.png"));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

describe("uploads", () => {
  it("detects real image types from bytes", () => {
    expect(detectImageType(PNG)).toBe("image/png");
    expect(detectImageType(JPEG)).toBe("image/jpeg");
    expect(detectImageType(WEBP)).toBe("image/webp");
    expect(detectImageType(Buffer.from("<svg></svg>"))).toBeNull();
  });

  it("saves, checks and reads back as a data URI", async () => {
    const r = saveUpload(dir, PNG);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(isUploadId(r.id)).toBe(true);
    expect(r.id).toMatch(/\.png$/);
    expect(uploadExists(dir, r.id)).toBe(true);
    const uri = await readUploadAsDataUri(dir, r.id);
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    expect(Buffer.from(uri.split(",")[1], "base64").equals(PNG)).toBe(true);
  });

  it("rejects non-images, empty and oversized files", () => {
    expect(saveUpload(dir, Buffer.from("hello"))).toMatchObject({ ok: false });
    expect(saveUpload(dir, Buffer.alloc(0))).toMatchObject({ ok: false });
    expect(saveUpload(dir, Buffer.concat([PNG, Buffer.alloc(MAX_UPLOAD_BYTES)]))).toMatchObject({ ok: false, error: expect.stringContaining("10 МБ") });
  });

  it("never resolves ids outside the uploads dir", async () => {
    expect(isUploadId("../app.db")).toBe(false);
    expect(uploadExists(dir, "../../etc/passwd")).toBe(false);
    await expect(readUploadAsDataUri(dir, "../app.db")).rejects.toThrow();
  });

  it("image params accept only upload ids", () => {
    const schema = [{ key: "image", label: "Картинка", type: "image" as const }];
    expect(validateParams(schema, { image: "123e4567-e89b-12d3-a456-426614174000.jpg" })).toMatchObject({ ok: true });
    expect(validateParams(schema, { image: "/etc/passwd" })).toMatchObject({ ok: false });
    expect(validateParams(schema, {})).toEqual({ ok: true, params: {} });
  });
});
