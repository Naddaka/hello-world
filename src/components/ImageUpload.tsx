"use client";

import { useState } from "react";

/** Uploads an image to /api/uploads and reports the upload id. */
export function ImageUpload({ name, value, onChange }: { name: string; value: string | undefined; onChange: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || `Ошибка ${res.status}`);
      else onChange(data.id);
    } catch {
      setError("Сервер недоступен.");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <span className="flex h-[42px] items-center gap-3">
        <img src={`/api/uploads/${value}`} alt="" className="h-10 w-10 rounded object-cover" />
        <button type="button" onClick={() => onChange("")} className="text-xs text-neutral-400 hover:text-white">
          Убрать
        </button>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <input
        type="file"
        name={name}
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        className="text-xs file:mr-2 file:rounded file:border-0 file:bg-neutral-700 file:px-2 file:py-1.5 file:text-neutral-100"
      />
      {busy && <span className="text-xs text-neutral-400">Загружаю…</span>}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </span>
  );
}
