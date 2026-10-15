import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/lib/uploads";

// Protected by proxy.ts like every /api route.
export async function POST(req: Request) {
  if (Number(req.headers.get("content-length")) > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Файл больше 10 МБ." }, { status: 413 });
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Ожидается multipart/form-data с полем file." }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не передан." }, { status: 400 });
  const res = saveUpload(config.dataDir, Buffer.from(await file.arrayBuffer()));
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ id: res.id, url: `/api/uploads/${res.id}` }, { status: 201 });
}
