import Link from "next/link";
import { getDb } from "@/db";
import { BudgetMeter } from "@/components/BudgetMeter";
import { Nav } from "@/components/Nav";
import { config } from "@/lib/config";
import { formatUsd, plural } from "@/lib/format";
import { budgetState, monthKey, monthRange, monthSummary, shiftMonth, type Breakdown } from "@/lib/spending";

export const dynamic = "force-dynamic";

const PROVIDER_NAMES: Record<string, string> = { fal: "fal.ai", byteplus: "BytePlus ModelArk", mock: "Mock" };

export default async function SpendingPage({ searchParams }: PageProps<"/spending">) {
  const { month } = await searchParams;
  const db = getDb();
  const tz = config.timezone;
  const range = monthRange(tz, typeof month === "string" ? month : undefined);
  const s = monthSummary(db, range);
  const isCurrent = range.key === monthKey(tz, new Date());
  const budget = config.monthlyBudget;
  const budgetNow = isCurrent && budget !== null ? budgetState(db, tz, budget) : null;

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Nav mode={config.providerMode} />
      <div className="mb-6 flex items-center gap-4">
        <h1 className="text-xl font-semibold">Расходы</h1>
        <nav className="flex items-center gap-3 text-sm">
          <Link href={`/spending?month=${shiftMonth(range.key, -1)}`} className="text-neutral-400 hover:text-white" aria-label="Предыдущий месяц">
            ←
          </Link>
          <span className="min-w-32 text-center capitalize">{range.label}</span>
          {!isCurrent && (
            <Link href={`/spending?month=${shiftMonth(range.key, 1)}`} className="text-neutral-400 hover:text-white" aria-label="Следующий месяц">
              →
            </Link>
          )}
        </nav>
      </div>

      <section className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Потрачено за месяц" value={formatUsd(s.total)} hero />
        <Tile label="Успешных генераций" value={String(s.doneCount)} note={s.failedCount ? `ещё ${s.failedCount} с ошибкой ($0)` : undefined} />
        <Tile label="Средняя цена генерации" value={s.avgDone === null ? "—" : formatUsd(s.avgDone)} />
        <Tile label="В работе" value={formatUsd(s.reserved)} note={s.activeCount ? `${s.activeCount} ${plural(s.activeCount, ["задача", "задачи", "задач"])}, по оценке` : "нет активных задач"} />
      </section>

      {budgetNow && (
        <section className="mb-8">
          <BudgetMeter budget={budgetNow.budget} spent={budgetNow.spent} reserved={budgetNow.reserved} />
        </section>
      )}
      {isCurrent && budget === null && <p className="mb-8 text-sm text-neutral-500">Месячный лимит не задан (MONTHLY_BUDGET_USD).</p>}

      <BreakdownTable
        title="По моделям"
        rows={s.byModel.map((m) => ({ ...m, sub: PROVIDER_NAMES[m.provider] ?? m.provider }))}
        subLabel="Провайдер"
      />
      <BreakdownTable title="По провайдерам" rows={s.byProvider.map((p) => ({ ...p, name: PROVIDER_NAMES[p.id] ?? p.id }))} />

      <p className="mt-8 text-xs leading-relaxed text-neutral-500">
        Учёт приблизительный. Успешная генерация считается по фактической стоимости от провайдера (если он её сообщает, как BytePlus), иначе по цене из
        каталога. Генерации с ошибкой считаются как $0. Месяц определяется по времени создания задачи, часовой пояс {tz}.
      </p>
    </main>
  );
}

function Tile({ label, value, note, hero }: { label: string; value: string; note?: string; hero?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <div className="text-xs text-neutral-400">{label}</div>
      <div className={hero ? "mt-1 text-4xl font-semibold" : "mt-1 text-2xl font-semibold"}>{value}</div>
      {note && <div className="mt-1 text-xs text-neutral-500">{note}</div>}
    </div>
  );
}

function BreakdownTable({ title, rows, subLabel }: { title: string; rows: (Breakdown & { sub?: string })[]; subLabel?: string }) {
  const max = Math.max(...rows.map((r) => r.total), 0);
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">За этот месяц оплаченных генераций нет.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-neutral-400">
            <tr className="border-b border-neutral-800">
              <th className="py-2 pr-4 font-normal">Название</th>
              {subLabel && <th className="py-2 pr-4 font-normal">{subLabel}</th>}
              <th className="py-2 pr-4 text-right font-normal">Генераций</th>
              <th className="py-2 pr-4 text-right font-normal">Средняя</th>
              <th className="py-2 pr-4 text-right font-normal">Сумма</th>
              <th className="w-1/4 py-2 font-normal">
                <span className="sr-only">Доля</span>
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-neutral-900">
                <td className="py-2 pr-4">{r.name}</td>
                {subLabel && <td className="py-2 pr-4 text-neutral-400">{r.sub}</td>}
                <td className="py-2 pr-4 text-right">{r.count}</td>
                <td className="py-2 pr-4 text-right">{formatUsd(r.avg)}</td>
                <td className="py-2 pr-4 text-right font-medium">{formatUsd(r.total)}</td>
                <td className="py-2" title={`${r.name}: ${formatUsd(r.total)}${max ? ` (${Math.round((r.total / max) * 100)}% от максимума)` : ""}`}>
                  <div className="h-2 rounded-r" style={{ width: `${max ? Math.max(2, (r.total / max) * 100) : 0}%`, background: "#3987e5" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
