// BytePlus ModelArk video generation (Seedance).
// Docs (checked 2026-10-15):
//   Base URL / auth: https://docs.byteplus.com/en/docs/ModelArk/base-url-and-authentication
//     data plane https://ark.ap-southeast.bytepluses.com/api/v3, header "Authorization: Bearer $ARK_API_KEY"
//   Create task:     POST /contents/generations/tasks -> { id }
//     https://docs.byteplus.com/en/docs/ModelArk/create-video-generation-task-api
//   Retrieve task:   GET /contents/generations/tasks/{id}
//     -> { status: queued | running | succeeded | failed | expired, content: { video_url }, usage: { completion_tokens }, error }
//     https://docs.byteplus.com/en/docs/ModelArk/get-video-generation-task-api
//     Video URLs are valid for 24 hours (we download right away).
//   Seedance 2.5 constraints: https://docs.byteplus.com/en/docs/ModelArk/seedance-2-5
//     first_frame / last_frame images require ratio "adaptive".
// Error body (verified against the live API): { error: { code, message, param, type } }.

import type { Model } from "@/db/schema";
import type { GenerateInput, ProviderAdapter, ProviderStatus } from "./types";

export const BYTEPLUS_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

/** Params handled by the adapter itself rather than passed through to the API body. */
const IMAGE_PARAM = "image";
const IMAGE_ROLE_PARAM = "image_role";

export type BytePlusOptions = {
  apiKey: () => string | undefined;
  /** Reads an uploaded image and returns a data: URI. */
  readImage: (uploadId: string) => Promise<string>;
  fetch?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
};

export function bytePlusErrorMessage(status: number, body: unknown): string {
  const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (e?.message) return `BytePlus: ${e.message}${e.code ? ` (${e.code}, HTTP ${status})` : ` (HTTP ${status})`}`;
  return `BytePlus: HTTP ${status}`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text.slice(0, 300) || undefined } };
  }
}

/** Build the create-task body from our job: text prompt + optional image + API params. */
export async function buildTaskBody(model: Model, input: GenerateInput, readImage: (id: string) => Promise<string>) {
  const { [IMAGE_PARAM]: image, [IMAGE_ROLE_PARAM]: role, ...params } = input.params;
  const content: Record<string, unknown>[] = [{ type: "text", text: input.prompt }];
  const body: Record<string, unknown> = { model: model.providerModelId, content, ...params };
  if (typeof image === "string" && image) {
    const imageRole = typeof role === "string" && role ? role : "first_frame";
    content.push({ type: "image_url", image_url: { url: await readImage(image) }, role: imageRole });
    // First-frame generation keeps the image's aspect ratio; Seedance 2.5 accepts only "adaptive" here.
    // TODO(byteplus): docs state this constraint for 2.5 only; we apply it to the 2.0 series too
    // ("adaptive" is a supported ratio there), confirm on a real 2.0 Fast run.
    if (imageRole === "first_frame") body.ratio = "adaptive";
  }
  return body;
}

export function createBytePlusAdapter(opts: BytePlusOptions): ProviderAdapter {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? BYTEPLUS_BASE_URL;
  const timeoutMs = opts.timeoutMs ?? 120_000; // base64 images make create requests large

  function headers(): HeadersInit {
    const key = opts.apiKey();
    if (!key) throw new Error("BytePlus: не задан BYTEPLUS_API_KEY.");
    return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  return {
    async generate(model: Model, input: GenerateInput) {
      const body = await buildTaskBody(model, input, opts.readImage);
      const res = await doFetch(`${base}/contents/generations/tasks`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = (await readJson(res)) as { id?: string };
      if (!res.ok) throw new Error(bytePlusErrorMessage(res.status, json));
      if (!json.id) throw new Error("BytePlus: в ответе нет id задачи.");
      return json.id;
    },

    async getStatus(_model: Model, providerJobId: string): Promise<ProviderStatus> {
      const res = await doFetch(`${base}/contents/generations/tasks/${encodeURIComponent(providerJobId)}`, {
        headers: headers(),
        signal: AbortSignal.timeout(60_000),
      });
      const json = (await readJson(res)) as {
        status?: string;
        content?: { video_url?: string };
        usage?: { completion_tokens?: number };
        error?: { code?: string; message?: string } | null;
      };
      if (!res.ok) {
        // 404: task gone (records are kept 7 days). 429 / 5xx: transient, retried next tick.
        if (res.status === 404) return { status: "failed", error: bytePlusErrorMessage(res.status, json) };
        throw new Error(bytePlusErrorMessage(res.status, json));
      }
      switch (json.status) {
        case "queued":
          return { status: "queued" };
        case "running":
          return { status: "running" };
        case "succeeded": {
          const url = json.content?.video_url;
          if (!url) return { status: "failed", error: "BytePlus: задача выполнена, но ссылки на видео нет." };
          return { status: "done", resultUrls: [url], usage: { tokens: json.usage?.completion_tokens } };
        }
        case "failed":
          // TODO(byteplus): the docs don't spell out the task error object; we assume the same
          // { code, message } shape as HTTP errors (verified for those).
          return {
            status: "failed",
            error: json.error?.message
              ? `BytePlus: ${json.error.message}${json.error.code ? ` (${json.error.code})` : ""}`
              : "BytePlus: генерация завершилась ошибкой без описания.",
          };
        case "expired":
          return { status: "failed", error: "BytePlus: задача не выполнена до истечения срока (expired)." };
        case "cancelled":
          return { status: "failed", error: "BytePlus: задача отменена." };
        default:
          throw new Error(`BytePlus: неизвестный статус ${json.status}`);
      }
    },
  };
}
