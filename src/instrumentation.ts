export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Apply migrations before the server takes requests.
  const { getDb } = await import("@/db");
  getDb();
}
