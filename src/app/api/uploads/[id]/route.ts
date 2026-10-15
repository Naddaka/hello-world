import fs from "node:fs";
import { config } from "@/lib/config";
import { uploadMime, uploadPath } from "@/lib/uploads";

export async function GET(_req: Request, ctx: RouteContext<"/api/uploads/[id]">) {
  const { id } = await ctx.params;
  const p = uploadPath(config.dataDir, id);
  if (!p || !fs.existsSync(p)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await fs.promises.readFile(p)), {
    headers: { "Content-Type": uploadMime(id), "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
