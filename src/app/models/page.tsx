import { asc, desc } from "drizzle-orm";
import { getDb } from "@/db";
import { models } from "@/db/schema";
import { Nav } from "@/components/Nav";
import { config } from "@/lib/config";
import { ModelRow } from "./ModelRow";

export const dynamic = "force-dynamic";

export default function ModelsPage() {
  const rows = getDb().select().from(models).orderBy(desc(models.type), asc(models.provider), asc(models.name)).all();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Nav mode={config.providerMode} />
      <h1 className="mb-2 text-xl font-semibold">Модели и цены</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Цены провайдеров меняются, правьте их здесь. Новые цены влияют на оценку новых генераций и на проверку лимита; уже созданные задачи не
        пересчитываются.
      </p>
      {rows.map((m) => (
        <ModelRow key={m.id} model={{ ...m, priceRules: m.priceRules ? JSON.stringify(m.priceRules, null, 2) : "" }} />
      ))}
    </main>
  );
}
