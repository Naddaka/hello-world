import Link from "next/link";
import { getDb } from "@/db";
import { GenerateForm } from "@/components/GenerateForm";
import { JobsTable } from "@/components/JobsTable";
import { Nav } from "@/components/Nav";
import { listAvailableModels } from "@/lib/catalog";
import { config } from "@/lib/config";
import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const RECENT = 10;

export default function Home() {
  const db = getDb();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Nav mode={config.providerMode} />
      <GenerateForm models={listAvailableModels(db)} />
      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Последние генерации</h2>
          <Link href="/history" className="text-sm text-neutral-400 hover:text-white">
            Вся история →
          </Link>
        </div>
        <JobsTable initial={listJobs(db, RECENT)} limit={RECENT} timeZone={config.timezone} />
      </section>
    </main>
  );
}
