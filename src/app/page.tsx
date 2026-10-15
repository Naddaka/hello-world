import Link from "next/link";
import { getDb } from "@/db";
import { GenerateForm } from "@/components/GenerateForm";
import { JobsTable } from "@/components/JobsTable";
import { Nav } from "@/components/Nav";
import { listAvailableModels } from "@/lib/catalog";
import { config } from "@/lib/config";
import { listJobs } from "@/lib/jobs";
import { formatUsd } from "@/lib/format";
import { budgetState, monthRange, monthSummary } from "@/lib/spending";
import { BudgetMeter } from "@/components/BudgetMeter";

export const dynamic = "force-dynamic";

const RECENT = 10;

export default function Home() {
  const db = getDb();
  const budget = config.monthlyBudget;
  const b = budget === null ? null : budgetState(db, config.timezone, budget);
  const month = monthRange(config.timezone, undefined);
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Nav mode={config.providerMode} />
      <section className="mb-6">
        {b ? (
          <BudgetMeter budget={b.budget} spent={b.spent} reserved={b.reserved} />
        ) : (
          <p className="text-xs text-neutral-400">
            Потрачено за {month.label}: {formatUsd(monthSummary(db, month).total)}
          </p>
        )}
      </section>
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
