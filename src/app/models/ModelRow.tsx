"use client";

import { useActionState } from "react";
import type { Model } from "@/db/schema";
import { updateModel, type UpdateModelState } from "./actions";

const UNIT: Record<Model["priceUnit"], string> = {
  per_second: "за секунду",
  per_image: "за изображение",
  per_generation: "за генерацию",
  per_1m_tokens: "за 1M токенов",
};

type Row = Pick<Model, "id" | "name" | "provider" | "providerModelId" | "type" | "priceUnit" | "priceUsd" | "enabled"> & { priceRules: string };

export function ModelRow({ model: m }: { model: Row }) {
  const [state, action, pending] = useActionState<UpdateModelState, FormData>(updateModel, {});
  return (
    <form action={action} className="grid grid-cols-1 gap-3 border-b border-neutral-900 py-4 sm:grid-cols-[1fr_auto]">
      <input type="hidden" name="id" value={m.id} />
      <div>
        <div className="font-medium">
          {m.name} <span className="text-xs text-neutral-500">{m.type === "video" ? "видео" : "изображение"}</span>
        </div>
        <div className="text-xs text-neutral-500">
          {m.provider} · <code>{m.providerModelId}</code>
        </div>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-neutral-400">Правила цены (JSON)</summary>
          <textarea
            name="priceRules"
            defaultValue={m.priceRules}
            rows={6}
            spellCheck={false}
            className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs"
          />
        </details>
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <label className="flex items-center gap-2 text-sm">
          $
          <input
            name="priceUsd"
            defaultValue={m.priceUsd}
            inputMode="decimal"
            className="w-24 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-right tabular-nums"
          />
          <span className="text-neutral-400">{UNIT[m.priceUnit]}</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={m.enabled} className="h-4 w-4" />
          Включена
        </label>
        <button disabled={pending} className="rounded bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
          {pending ? "…" : "Сохранить"}
        </button>
        {state.ok && <span className="text-xs text-green-400">Сохранено</span>}
        {state.error && <span className="text-xs text-red-400">{state.error}</span>}
      </div>
    </form>
  );
}
