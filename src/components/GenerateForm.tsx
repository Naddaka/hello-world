"use client";

import { useMemo, useState } from "react";
import type { ModelView } from "@/lib/catalog";
import type { ParamField, ParamValues } from "@/lib/params";
import { estimateCost } from "@/lib/pricing";
import { formatUsd } from "@/lib/format";
import { ImageUpload } from "./ImageUpload";

export const JOBS_CHANGED = "jobs:changed";

function defaults(schema: ParamField[]): ParamValues {
  const out: ParamValues = {};
  for (const f of schema) if ("default" in f && f.default !== undefined) out[f.key] = f.default;
  return out;
}

const inputCls = "w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2";

export function GenerateForm({ models }: { models: ModelView[] }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const model = models.find((m) => m.id === modelId);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<ParamValues>(() => defaults(model?.paramsSchema ?? []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const estimate = useMemo(() => (model ? estimateCost(model, params) : null), [model, params]);

  if (!model) return <p className="text-neutral-400">В каталоге нет доступных моделей.</p>;

  function selectModel(id: string) {
    setModelId(id);
    setParams(defaults(models.find((m) => m.id === id)?.paramsSchema ?? []));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId, prompt, params }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ kind: "error", text: data.error || `Ошибка ${res.status}` });
      else {
        setMsg({ kind: "ok", text: "Задача поставлена в очередь." });
        window.dispatchEvent(new Event(JOBS_CHANGED));
      }
    } catch {
      setMsg({ kind: "error", text: "Сервер недоступен." });
    } finally {
      setBusy(false);
    }
  }

  const groups = (["video", "image"] as const).map((t) => ({ t, items: models.filter((m) => m.type === t) }));

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Модель
        <select name="model" value={modelId} onChange={(e) => selectModel(e.target.value)} className={inputCls}>
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <optgroup key={g.t} label={g.t === "video" ? "Видео" : "Изображения"}>
                  {g.items.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              ),
          )}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Промпт
        <textarea
          name="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          required
          className={inputCls}
        />
      </label>

      {model.paramsSchema.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {model.paramsSchema.map((f) => (
            <Field key={f.key} field={f} value={params[f.key]} onChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-4">
        <button disabled={busy} className="rounded bg-white px-4 py-2 font-medium text-black disabled:opacity-50">
          {busy ? "Отправляю…" : "Сгенерировать"}
        </button>
        <span className="text-sm text-neutral-400">Оценка: {formatUsd(estimate)}</span>
        {msg && <span className={msg.kind === "ok" ? "text-sm text-green-400" : "text-sm text-red-400"}>{msg.text}</span>}
      </div>
    </form>
  );
}

function Field({
  field: f,
  value,
  onChange,
}: {
  field: ParamField;
  value: ParamValues[string] | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  let control: React.ReactNode;
  switch (f.type) {
    case "select":
      control = (
        <select
          name={f.key}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => {
            const opt = f.options.find((o) => String(o.value) === e.target.value);
            onChange(opt ? opt.value : e.target.value);
          }}
          className={inputCls}
        >
          {!f.required && f.default === undefined && <option value="">—</option>}
          {f.options.map((o) => (
            <option key={String(o.value)} value={String(o.value)}>
              {o.label ?? String(o.value)}
            </option>
          ))}
        </select>
      );
      break;
    case "number":
      control = (
        <input
          type="number"
          name={f.key}
          min={f.min}
          max={f.max}
          step={f.step ?? (f.integer ? 1 : "any")}
          value={value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className={inputCls}
        />
      );
      break;
    case "boolean":
      control = (
        <span className="flex h-[42px] items-center">
          <input type="checkbox" name={f.key} checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
        </span>
      );
      break;
    case "text":
      control = (
        <input name={f.key} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      );
      break;
    case "image":
      control = <ImageUpload name={f.key} value={value === undefined ? undefined : String(value)} onChange={onChange} />;
      break;
  }
  return (
    <label className="flex flex-col gap-1 text-sm" title={f.help}>
      {f.label}
      {control}
    </label>
  );
}
