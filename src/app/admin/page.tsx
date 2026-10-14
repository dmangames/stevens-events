import Link from "next/link";
import { signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { seatsTakenBySession } from "@/lib/capacity";
import { formatMoney, formatSession, zonedToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const user = await requireRole("OWNER", "STAFF");

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  // From the start of today (event time zone) through the next 7 days.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date()).split("-").map(Number);
  const from = zonedToUtc(parts[0], parts[1], parts[2], 0, 0);
  const to = new Date(from.getTime() + 8 * 86_400_000);
  const sessions = await prisma.session.findMany({
    where: { startsAt: { gte: from, lt: to }, status: { not: "CANCELLED" } },
    include: { event: true },
    orderBy: { startsAt: "asc" },
  });
  const taken = await seatsTakenBySession(sessions.map((s) => s.id));
  const checkedIn = new Map<string, number>();
  for (const t of await prisma.ticket.findMany({
    where: { status: "CHECKED_IN", order: { sessionId: { in: sessions.map((s) => s.id) } } },
    select: { order: { select: { sessionId: true } } },
  })) {
    checkedIn.set(t.order.sessionId, (checkedIn.get(t.order.sessionId) ?? 0) + 1);
  }

  let stats: { tickets: number; revenue: number } | null = null;
  if (user.role === "OWNER") {
    const paid = await prisma.order.aggregate({
      where: { status: "PAID", session: { startsAt: { gte: from } } },
      _sum: { totalCents: true },
    });
    const tickets = await prisma.ticket.count({ where: { status: { not: "VOID" }, order: { status: "PAID", session: { startsAt: { gte: from } } } } });
    stats = { tickets, revenue: paid._sum.totalCents ?? 0 };
  }

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-bold">Admin</h1>
      <p className="mt-2 text-slate-600">Signed in as {user.email} ({user.role})</p>

      {stats && (
        <p className="mt-4 text-sm text-slate-600">
          Upcoming: <b>{stats.tickets}</b> tickets sold · <b>{formatMoney(stats.revenue)}</b> revenue
        </p>
      )}

      <h2 className="mt-8 text-lg font-semibold">Today and the next 7 days</h2>
      <ul className="mt-3 divide-y rounded border">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span>
              <span className="font-medium">{s.event.title}</span>
              <span className="block text-sm text-slate-500">
                {formatSession(s.startsAt)} · {taken.get(s.id) ?? 0}/{s.capacity} seats · {checkedIn.get(s.id) ?? 0} checked in
              </span>
            </span>
            <span className="flex gap-2 text-sm">
              <Link href={`/admin/sessions/${s.id}/scan`} className="rounded bg-slate-900 px-3 py-1.5 text-white">Scan</Link>
              <Link href={`/admin/sessions/${s.id}`} className="rounded border px-3 py-1.5">Guest list</Link>
            </span>
          </li>
        ))}
        {!sessions.length && <li className="px-4 py-6 text-slate-500">No sessions in this window.</li>}
      </ul>

      <form action={logout} className="mt-8">
        <button className="rounded border px-3 py-2">Sign out</button>
      </form>
    </main>
  );
}
