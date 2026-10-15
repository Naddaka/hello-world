import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { createJob, listJobs } from "@/lib/jobs";
import { config } from "@/lib/config";
import { uploadExists } from "@/lib/uploads";
import { isModelAvailable } from "@/providers";

export async function GET(req: Request) {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 50, 1), 500);
  return NextResponse.json({ jobs: listJobs(getDb(), limit) });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }
  const res = createJob(
    getDb(),
    { modelId: body.modelId, prompt: body.prompt, params: body.params },
    { isModelAvailable, uploadExists: (id) => uploadExists(config.dataDir, id) },
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ id: res.id }, { status: 201 });
}
