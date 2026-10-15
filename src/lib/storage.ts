import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const RESULTS_DIR = "results";

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const EXT_TO_MIME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MIME_TO_EXT).map(([m, e]) => [e, m])),
  jpeg: "image/jpeg",
};

export function mimeForPath(p: string): string {
  return EXT_TO_MIME[path.extname(p).slice(1).toLowerCase()] ?? "application/octet-stream";
}

export function kindForPath(p: string): "video" | "image" | "other" {
  const m = mimeForPath(p);
  return m.startsWith("video/") ? "video" : m.startsWith("image/") ? "image" : "other";
}

function extFor(contentType: string | null, url: string): string {
  const mime = contentType?.split(";")[0].trim().toLowerCase();
  if (mime && MIME_TO_EXT[mime]) return MIME_TO_EXT[mime];
  try {
    const ext = path.extname(new URL(url).pathname).slice(1).toLowerCase();
    if (EXT_TO_MIME[ext]) return ext === "jpeg" ? "jpg" : ext;
  } catch {}
  return "bin";
}

/** Absolute path of a file stored under DATA_DIR/results, or null if the path escapes it. */
export function resolveResultPath(dataDir: string, rel: string): string | null {
  const root = path.resolve(dataDir, RESULTS_DIR);
  const abs = path.resolve(dataDir, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export type SaveOptions = {
  fetch?: typeof fetch;
  /** Abort downloads bigger than this. */
  maxBytes?: number;
  timeoutMs?: number;
  mockAssetsDir?: string;
};

const DEFAULT_MAX_BYTES = 2 * 1024 ** 3;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Download one result into DATA_DIR/results/<jobId>/<index>.<ext> and return the path
 * relative to DATA_DIR. Supports http(s), data: URIs and mock:// (bundled sample files).
 * Writes to a temp file first, so a broken download never leaves a half file in place.
 */
export async function saveResult(dataDir: string, url: string, jobId: string, index: number, opts: SaveOptions = {}): Promise<string> {
  if (!/^[\w-]+$/.test(jobId)) throw new Error(`Некорректный id задачи: ${jobId}`);
  const dir = path.join(dataDir, RESULTS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });

  const finish = async (ext: string, write: (tmp: string) => Promise<void> | void) => {
    const name = `${index}.${ext}`;
    const tmp = path.join(dir, `${name}.part`);
    try {
      await write(tmp);
      fs.renameSync(tmp, path.join(dir, name));
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    return path.join(RESULTS_DIR, jobId, name);
  };

  if (url.startsWith("mock://")) {
    const video = url === "mock://video";
    // Literal paths so the bundler traces (and ships) exactly these two files.
    const src = opts.mockAssetsDir
      ? path.join(/*turbopackIgnore: true*/ opts.mockAssetsDir, video ? "sample.mp4" : "sample.png")
      : video
        ? path.join(process.cwd(), "assets/mock/sample.mp4")
        : path.join(process.cwd(), "assets/mock/sample.png");
    return finish(path.extname(src).slice(1), (tmp) => fs.copyFileSync(src, tmp));
  }

  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) throw new Error("Некорректный data URI результата.");
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    return finish(extFor(m[1] ?? null, "x:"), (tmp) => fs.writeFileSync(tmp, buf));
  }

  if (!/^https?:\/\//.test(url)) throw new Error("Неподдерживаемый адрес результата.");
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  if (!res.ok || !res.body) throw new Error(`Скачивание результата: HTTP ${res.status}`);
  if (Number(res.headers.get("content-length")) > maxBytes) throw new Error("Файл результата слишком большой.");

  return finish(extFor(res.headers.get("content-type"), url), async (tmp) => {
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        cb(size > maxBytes ? new Error("Файл результата слишком большой.") : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), limit, fs.createWriteStream(tmp));
  });
}

/** Parse a single "bytes=a-b" Range header. Returns null for absent/unsupported, "invalid" for unsatisfiable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number, end: number;
  if (m[1] === "") {
    // suffix: last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}
