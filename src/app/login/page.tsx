import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto mt-32 w-full max-w-xs">
      <h1 className="mb-6 text-xl font-semibold">Вход</h1>
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </main>
  );
}
