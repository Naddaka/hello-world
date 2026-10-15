"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        placeholder="Пароль"
        autoFocus
        required
        className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
      />
      <button
        disabled={pending}
        className="rounded bg-white px-3 py-2 font-medium text-black disabled:opacity-50"
      >
        {pending ? "Проверяю…" : "Войти"}
      </button>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
    </form>
  );
}
