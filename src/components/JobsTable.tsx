"use client";

import { useCallback, useEffect, useState } from "react";
import type { JobStatus } from "@/db/schema";
import type { JobView } from "@/lib/jobs";
import { formatDateTime, formatDuration, formatUsd } from "@/lib/format";
import { JOBS_CHANGED } from "./GenerateForm";

const STATUS: Record<JobStatus, { label: string; cls: string }> = {
  queued: { label: "В очереди", cls: "bg-neutral-700 text-neutral-200" },
  running: { label: "Генерируется", cls: "bg-blue-500/20 text-blue-300 animate-pulse" },
  done: { label: "Готово", cls: "bg-green-500/20 text-green-300" },
  failed: { label: "Ошибка", cls: "bg-red-500/20 text-red-300" },
};

const POLL_MS = 2000;

export function JobsTable({ initial, limit, timeZone }: { initial: JobView[]; limit: number; timeZone: string }) {
  const [jobs, setJobs] = useState(initial);
  const [, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs?limit=${limit}`, { cache: "no-store" });
      if (res.ok) setJobs((await res.json()).jobs);
    } catch {
      // offline for a moment; next poll will retry
    }
  }, [limit]);

  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  // Poll only while something is in progress.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      refresh();
      setTick((n) => n + 1);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [active, refresh]);

  useEffect(() => {
    window.addEventListener(JOBS_CHANGED, refresh);
    return () => window.removeEventListener(JOBS_CHANGED, refresh);
  }, [refresh]);

  if (jobs.length === 0) return <p className="text-sm text-neutral-500">Генераций пока нет.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-neutral-400">
          <tr className="border-b border-neutral-800">
            <th className="py-2 pr-4 font-normal">Создана</th>
            <th className="py-2 pr-4 font-normal">Модель</th>
            <th className="py-2 pr-4 font-normal">Промпт</th>
            <th className="py-2 pr-4 font-normal">Статус</th>
            <th className="py-2 pr-4 font-normal">Время</th>
            <th className="py-2 font-normal">Стоимость</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} data-job-id={j.id} className="border-b border-neutral-900 align-top">
              <td className="py-2 pr-4 whitespace-nowrap text-neutral-400">{formatDateTime(j.createdAt, timeZone)}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{j.modelName}</td>
              <td className="py-2 pr-4">
                <div className="line-clamp-2 max-w-md" title={j.prompt}>
                  {j.prompt}
                </div>
                {j.error && <div className="mt-1 text-xs text-red-400">{j.error}</div>}
              </td>
              <td className="py-2 pr-4">
                <span data-status={j.status} className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${STATUS[j.status].cls}`}>
                  {STATUS[j.status].label}
                </span>
              </td>
              <td className="py-2 pr-4 whitespace-nowrap text-neutral-400">{formatDuration(j.startedAt, j.finishedAt)}</td>
              <td className="py-2 whitespace-nowrap">{formatUsd(j.costEstimate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
