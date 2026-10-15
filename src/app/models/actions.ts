"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { models } from "@/db/schema";

export type UpdateModelState = { ok?: boolean; error?: string };

/** Edit price / pricing rules / enabled flag of a catalog model. Runs behind the session check (proxy). */
export async function updateModel(_prev: UpdateModelState, form: FormData): Promise<UpdateModelState> {
  const id = String(form.get("id") ?? "");
  const price = Number(String(form.get("priceUsd") ?? "").replace(",", "."));
  if (!Number.isFinite(price) || price < 0) return { error: "Цена должна быть неотрицательным числом." };

  let priceRules: unknown = null;
  const rawRules = String(form.get("priceRules") ?? "").trim();
  if (rawRules) {
    try {
      priceRules = JSON.parse(rawRules);
    } catch {
      return { error: "Правила цены: некорректный JSON." };
    }
    if (typeof priceRules !== "object" || Array.isArray(priceRules)) return { error: "Правила цены должны быть JSON-объектом." };
  }

  const res = getDb()
    .update(models)
    .set({ priceUsd: price, priceRules, enabled: form.get("enabled") === "on" })
    .where(eq(models.id, id))
    .run();
  if (res.changes === 0) return { error: "Модель не найдена." };
  revalidatePath("/models");
  revalidatePath("/");
  return { ok: true };
}
