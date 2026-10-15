import { getDb } from "@/db";
import { JobsTable } from "@/components/JobsTable";
import { Nav } from "@/components/Nav";
import { config } from "@/lib/config";
import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const LIMIT = 200;

export default function HistoryPage() {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Nav mode={config.providerMode} />
      <h1 className="mb-4 text-xl font-semibold">История</h1>
      <JobsTable initial={listJobs(getDb(), LIMIT)} limit={LIMIT} timeZone={config.timezone} />
    </main>
  );
}
