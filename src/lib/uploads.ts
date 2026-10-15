import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_ID_RE } from "./params";

// Reference images uploaded from the form. Stored in DATA_DIR/uploads/<uuid>.<ext>;
// the upload id (file name) is what goes into job params.

export const UPLOADS_DIR = "uploads";
/** Images are sent to providers inline as base64; keep them small (BytePlus: < 30 MB, body < 64 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

export function isUploadId(v: unknown): v is string {
  return typeof v === "string" && UPLOAD_ID_RE.test(v);
}

/** Sniff the real type from magic bytes rather than trusting the browser. */
export function detectImageType(buf: Buffer): string | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export type SaveUploadResult = { ok: true; id: string } | { ok: false; error: string };

export function saveUpload(dataDir: string, buf: Buffer): SaveUploadResult {
  if (buf.length === 0) return { ok: false, error: "Пустой файл." };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Файл больше 10 МБ." };
  const type = detectImageType(buf);
  if (!type) return { ok: false, error: "Поддерживаются только PNG, JPEG и WebP." };
  const id = `${randomUUID()}.${TYPES[type]}`;
  const dir = path.join(dataDir, UPLOADS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id), buf);
  return { ok: true, id };
}

export function uploadPath(dataDir: string, id: string): string | null {
  return isUploadId(id) ? path.join(dataDir, UPLOADS_DIR, id) : null;
}

export function uploadExists(dataDir: string, id: string): boolean {
  const p = uploadPath(dataDir, id);
  return !!p && fs.existsSync(p);
}

export function uploadMime(id: string): string {
  return MIME[path.extname(id).slice(1)] ?? "application/octet-stream";
}

/** data:<mime>;base64,... for sending to a provider. */
export async function readUploadAsDataUri(dataDir: string, id: string): Promise<string> {
  const p = uploadPath(dataDir, id);
  if (!p || !fs.existsSync(p)) throw new Error("Референс-изображение не найдено на сервере.");
  return `data:${uploadMime(id)};base64,${(await fs.promises.readFile(p)).toString("base64")}`;
}
