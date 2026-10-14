import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

type Role = "OWNER" | "STAFF";

/** Call at the top of every admin page, server action and API route. */
export async function requireRole(...allowed: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // The login cookie can outlive the account, so confirm against the database that the user still
  // exists, hasn't been revoked, and still has the role the cookie claims.
  const current = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true, email: true } });
  if (!current || current.email.endsWith("@invalid.local")) redirect("/login");
  const user = { ...session.user, role: current.role };
  if (allowed.length && !allowed.includes(user.role)) redirect("/admin");
  return user;
}
