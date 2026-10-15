// fal.ai adapter over the queue REST API.
// Docs: https://fal.ai/docs/documentation/model-apis/inference/queue
//   submit: POST https://queue.fal.run/{endpoint_id}            -> { request_id, status_url, response_url }
//   status: GET  status_url                                     -> { status: IN_QUEUE | IN_PROGRESS | COMPLETED, error?, error_type? }
//   result: GET  response_url                                   -> model-specific output ({ video: File } / { images: File[] })
// Auth header: "Authorization: Key $FAL_KEY".
// Errors: { detail: string, error_type? } (request errors) or { detail: [{ loc, msg, type }] } (model validation errors).

import type { Model } from "@/db/schema";
import type { GenerateInput, ProviderAdapter, ProviderStatus } from "./types";

export const FAL_QUEUE_URL = "https://queue.fal.run";

type FalRef = { id: string; status: string; response: string };

export type FalOptions = {
  apiKey: () => string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Human-readable message from a fal error body. Never includes request headers. */
export function falErrorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  let msg: string | undefined;
  if (typeof detail === "string") msg = detail;
  else if (Array.isArray(detail)) {
    msg = detail
      .map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((x) => x !== "body").join(".") : "";
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .filter(Boolean)
      .join("; ");
  }
  return `fal.ai: ${msg || `HTTP ${status}`}${msg ? ` (HTTP ${status})` : ""}`;
}

/** Collect output file URLs from a model response: { video }, { videos }, { image }, { images }. */
export function falResultUrls(output: unknown): string[] {
  const o = (output ?? {}) as Record<string, unknown>;
  const files = [o.video, ...(Array.isArray(o.videos) ? o.videos : []), o.image, ...(Array.isArray(o.images) ? o.images : [])];
  return files.map((f) => (f as { url?: unknown } | undefined)?.url).filter((u): u is string => typeof u === "string" && u.length > 0);
}

function parseRef(providerJobId: string, model: Model): FalRef {
  try {
    const r = JSON.parse(providerJobId) as FalRef;
    if (r && typeof r.id === "string" && typeof r.status === "string" && typeof r.response === "string") return r;
  } catch {}
  // Bare request id: build the URLs from the endpoint id (works for single-path endpoints).
  const base = `${FAL_QUEUE_URL}/${model.providerModelId}/requests/${providerJobId}`;
  return { id: providerJobId, status: `${base}/status`, response: base };
}

/** The API key is only ever sent to fal's queue host. */
function assertFalUrl(url: string) {
  if (!url.startsWith(FAL_QUEUE_URL + "/")) throw new Error(`fal.ai: неожиданный адрес очереди ${url}`);
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text.slice(0, 300) || undefined };
  }
}

export function createFalAdapter(opts: FalOptions): ProviderAdapter {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;

  function headers(): HeadersInit {
    const key = opts.apiKey();
    if (!key) throw new Error("fal.ai: не задан FAL_KEY.");
    return { Authorization: `Key ${key}`, "Content-Type": "application/json" };
  }

  async function get(url: string): Promise<{ res: Response; body: unknown }> {
    assertFalUrl(url);
    const res = await doFetch(url, { headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
    return { res, body: await readJson(res) };
  }

  return {
    async generate(model: Model, input: GenerateInput) {
      const url = `${FAL_QUEUE_URL}/${model.providerModelId}`;
      const res = await doFetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ prompt: input.prompt, ...input.params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await readJson(res)) as { request_id?: string; status_url?: string; response_url?: string };
      if (!res.ok) throw new Error(falErrorMessage(res.status, body));
      if (!body.request_id) throw new Error("fal.ai: в ответе нет request_id.");
      // Keep the URLs fal returned: for multi-segment endpoint ids they differ from the submit path.
      const ref: FalRef = {
        id: body.request_id,
        status: body.status_url ?? `${url}/requests/${body.request_id}/status`,
        response: body.response_url ?? `${url}/requests/${body.request_id}`,
      };
      return JSON.stringify(ref);
    },

    async getStatus(model: Model, providerJobId: string): Promise<ProviderStatus> {
      const ref = parseRef(providerJobId, model);

      const st = await get(ref.status);
      if (st.res.status === 404) return { status: "failed", error: "fal.ai: запрос не найден в очереди." };
      if (!st.res.ok) throw new Error(falErrorMessage(st.res.status, st.body)); // transient: retried next tick
      const s = st.body as { status?: string; error?: string; error_type?: string };
      if (s.status === "IN_QUEUE") return { status: "queued" };
      if (s.status === "IN_PROGRESS") return { status: "running" };
      if (s.status !== "COMPLETED") throw new Error(`fal.ai: неизвестный статус ${s.status}`);
      if (s.error) return { status: "failed", error: `fal.ai: ${s.error}${s.error_type ? ` (${s.error_type})` : ""}` };

      const out = await get(ref.response);
      if (!out.res.ok) {
        // 4xx: the model rejected the input, final. 5xx: try again next tick.
        if (out.res.status >= 400 && out.res.status < 500) return { status: "failed", error: falErrorMessage(out.res.status, out.body) };
        throw new Error(falErrorMessage(out.res.status, out.body));
      }
      const urls = falResultUrls(out.body);
      if (urls.length === 0) return { status: "failed", error: "fal.ai: в ответе модели нет файлов." };
      return { status: "done", resultUrls: urls };
    },
  };
}
