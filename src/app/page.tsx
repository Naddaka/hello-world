import { count } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, models } from "@/db/schema";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const [m] = db.select({ n: count() }).from(models).all();
  const [j] = db.select({ n: count() }).from(jobs).all();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">GenHub</h1>
        <form action="/api/auth/logout" method="post">
          <button className="text-sm text-neutral-400 hover:text-white">Выйти</button>
        </form>
      </header>
      <p className="text-neutral-300">Каркас работает. Форма генерации появится на этапе 2.</p>
      <ul className="mt-4 text-sm text-neutral-400">
        <li>Режим провайдеров: {config.providerMode}</li>
        <li>Моделей в каталоге: {m.n}</li>
        <li>Задач: {j.n}</li>
      </ul>
    </main>
  );
}
