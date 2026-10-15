import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs } from "@/db/schema";
import { config } from "@/lib/config";
import { mimeForPath, parseRange, resolveResultPath } from "@/lib/storage";

// Access control is done by proxy.ts (every /api/* route requires a session).
// Files are looked up by job id + index, never by a path from the request.
export async function GET(req: Request, ctx: RouteContext<"/api/jobs/[id]/files/[index]">) {
  const { id, index } = await ctx.params;
  const job = getDb().select({ files: jobs.resultFiles }).from(jobs).where(eq(jobs.id, id)).get();
  const rel = job?.files?.[Number(index)];
  const abs = rel ? resolveResultPath(config.dataDir, rel) : null;
  if (!abs || !fs.existsSync(abs)) return new Response("Not found", { status: 404 });

  const size = fs.statSync(abs).size;
  const headers = new Headers({
    "Content-Type": mimeForPath(abs),
    "Accept-Ranges": "bytes",
    // Stored files never change.
    "Cache-Control": "private, max-age=31536000, immutable",
  });
  if (new URL(req.url).searchParams.has("download")) {
    headers.set("Content-Disposition", `attachment; filename="genhub-${id.slice(0, 8)}-${Number(index) + 1}${path.extname(abs)}"`);
  }

  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  const body = Readable.toWeb(fs.createReadStream(abs, { start, end })) as ReadableStream;
  return new Response(body, { status: range ? 206 : 200, headers });
}
