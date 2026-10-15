import Link from "next/link";

const LINKS = [
  { href: "/", label: "Генерация" },
  { href: "/history", label: "История" },
  { href: "/spending", label: "Расходы" },
  { href: "/models", label: "Модели" },
];

export function Nav({ mode }: { mode: "mock" | "real" }) {
  return (
    <header className="mb-8 flex items-center gap-6 border-b border-neutral-800 pb-4">
      <span className="text-lg font-semibold">GenHub</span>
      <nav className="flex gap-4 text-sm">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-neutral-300 hover:text-white">
            {l.label}
          </Link>
        ))}
      </nav>
      {mode === "mock" && (
        <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300" title="PROVIDER_MODE=mock">
          mock-режим
        </span>
      )}
      <form action="/api/auth/logout" method="post" className="ml-auto">
        <button className="text-sm text-neutral-400 hover:text-white">Выйти</button>
      </form>
    </header>
  );
}
