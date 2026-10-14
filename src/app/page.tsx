import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney, formatSession } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await prisma.event.findMany({
    where: { status: "PUBLISHED", sessions: { some: { status: "OPEN", startsAt: { gt: new Date() } } } },
    include: {
      ticketTypes: { select: { priceCents: true } },
      sessions: { where: { status: "OPEN", startsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" }, take: 1 },
    },
  });
  events.sort((a, b) => a.sessions[0].startsAt.getTime() - b.sessions[0].startsAt.getTime());

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-3xl font-bold">Steven&apos;s Events</h1>
      <ul className="mt-6 space-y-4">
        {events.map((e) => {
          const from = e.ticketTypes.length ? Math.min(...e.ticketTypes.map((t) => t.priceCents)) : null;
          return (
            <li key={e.id}>
              <Link href={`/events/${e.slug}`} className="block rounded border p-4 hover:bg-slate-50">
                <h2 className="text-lg font-semibold">{e.title}</h2>
                {e.location && <p className="text-sm text-slate-500">{e.location}</p>}
                <p className="mt-1 text-sm">
                  Next: {formatSession(e.sessions[0].startsAt)}
                  {from != null && <span className="text-slate-500"> · from {formatMoney(from)}</span>}
                </p>
              </Link>
            </li>
          );
        })}
        {!events.length && <li className="text-slate-500">No upcoming events right now. Check back soon.</li>}
      </ul>
    </main>
  );
}
