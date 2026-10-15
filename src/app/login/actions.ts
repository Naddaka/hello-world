"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  checkPassword,
  createSessionToken,
  safeNextPath,
  sessionSecret,
} from "@/lib/auth";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const secret = sessionSecret();
  if (!process.env.APP_PASSWORD || !secret) {
    return { error: "APP_PASSWORD не задан на сервере." };
  }
  const password = String(form.get("password") ?? "");
  if (!(await checkPassword(password))) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 1000));
    return { error: "Неверный пароль." };
  }
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect(safeNextPath(String(form.get("next") ?? "")));
}
