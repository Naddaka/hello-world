export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Apply migrations before the server takes requests, then start the job loop.
  const { getDb } = await import("@/db");
  getDb();
  const { startWorker } = await import("@/worker");
  startWorker();
}
