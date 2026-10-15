"use client";

import { useEffect, useState } from "react";
import type { JobFileView } from "@/lib/jobs";

/** Thumbnails of a job's results; click opens a full-size viewer. */
export function ResultPreview({ files }: { files: JobFileView[] }) {
  const [open, setOpen] = useState<JobFileView | null>(null);
  if (files.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {files.map((f) => (
          <div key={f.url} className="flex flex-col items-start gap-1">
            <button type="button" onClick={() => setOpen(f)} className="overflow-hidden rounded border border-neutral-800 hover:border-neutral-500">
              {f.kind === "video" ? (
                // #t=0.1 makes Safari render the first frame as a poster
                <video src={`${f.url}#t=0.1`} preload="metadata" muted playsInline className="h-16 w-28 bg-black object-cover" />
              ) : f.kind === "image" ? (
                <img src={f.url} alt="" loading="lazy" className="h-16 w-16 object-cover" />
              ) : (
                <span className="block p-2 text-xs">файл</span>
              )}
            </button>
            <a href={f.downloadUrl} className="text-xs text-neutral-400 hover:text-white" download>
              Скачать
            </a>
          </div>
        ))}
      </div>
      {open && <Viewer file={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Viewer({ file, onClose }: { file: JobFileView; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" onClick={onClose} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-6">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-full max-w-full flex-col items-center gap-3">
        {file.kind === "video" ? (
          <video src={file.url} controls autoPlay loop playsInline className="max-h-[80vh] max-w-full" />
        ) : (
          <img src={file.url} alt="" className="max-h-[80vh] max-w-full object-contain" />
        )}
        <div className="flex gap-4 text-sm">
          <a href={file.downloadUrl} download className="rounded bg-white px-3 py-1.5 font-medium text-black">
            Скачать
          </a>
          <a href={file.url} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-neutral-300 hover:text-white">
            Открыть в новой вкладке
          </a>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-neutral-300 hover:text-white">
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
