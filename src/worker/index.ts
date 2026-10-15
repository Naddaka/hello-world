import { getDb } from "@/db";
import { config } from "@/lib/config";
import { saveResult } from "@/lib/storage";
import { getAdapter } from "@/providers";
import { recoverInterrupted, tick, type WorkerDeps } from "./worker";

const g = globalThis as unknown as { __worker?: NodeJS.Timeout };

/** Background loop inside the Next.js server process. Started once from instrumentation.ts. */
export function startWorker() {
  if (g.__worker) return;
  const deps: WorkerDeps = {
    db: getDb(),
    getAdapter,
    saveResult: (url, jobId, index) => saveResult(config.dataDir, url, jobId, index),
    maxConcurrent: Number(process.env.MAX_CONCURRENT_JOBS) || 5,
    log: (m) => console.log(`[worker] ${m}`),
  };
  recoverInterrupted(deps);

  let busy = false;
  g.__worker = setInterval(
    async () => {
      if (busy) return; // previous tick still running
      busy = true;
      try {
        await tick(deps);
      } catch (e) {
        console.error("[worker] tick failed", e);
      } finally {
        busy = false;
      }
    },
    Number(process.env.WORKER_INTERVAL_MS) || 2000,
  );
  console.log("[worker] started");
}
