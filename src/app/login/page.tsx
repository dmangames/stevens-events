import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function login(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/admin",
      });
    } catch (e) {
      if (e instanceof AuthError) redirect("/login?error=1");
      throw e; // let the redirect through
    }
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-bold">Staff login</h1>
      {error && <p className="mt-3 text-sm text-red-600">Invalid email or password.</p>}
      <form action={login} className="mt-6 space-y-4">
        <input name="email" type="email" placeholder="Email" required autoComplete="username"
          className="w-full rounded border px-3 py-2" />
        <input name="password" type="password" placeholder="Password" required autoComplete="current-password"
          className="w-full rounded border px-3 py-2" />
        <button className="w-full rounded bg-slate-900 px-3 py-2 text-white">Sign in</button>
      </form>
    </main>
  );
}
