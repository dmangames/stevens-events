import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { seatsTakenBySession } from "@/lib/capacity";
import { formatMoney, formatSession } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      ticketTypes: { orderBy: { sortOrder: "asc" } },
      sessions: {
        where: { status: { in: ["OPEN", "CLOSED"] }, startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
      },
    },
  });
  if (!event || event.status !== "PUBLISHED") notFound();
  const taken = await seatsTakenBySession(event.sessions.map((s) => s.id));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <Link href="/" className="text-sm text-slate-500">← All events</Link>
      <h1 className="mt-2 text-3xl font-bold">{event.title}</h1>
      {event.location && <p className="text-slate-500">{event.location}</p>}
      {event.description && <p className="mt-4 whitespace-pre-line">{event.description}</p>}

      {event.ticketTypes.length > 0 && (
        <ul className="mt-6 text-sm">
          {event.ticketTypes.map((t) => (
            <li key={t.id}>{t.name}: {formatMoney(t.priceCents)}</li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-lg font-semibold">{event.type === "ONE_OFF" ? "Date" : "Choose a time"}</h2>
      <ul className="mt-3 divide-y rounded border">
        {event.sessions.map((s) => {
          const left = Math.max(0, s.capacity - (taken.get(s.id) ?? 0));
          const soldOut = left === 0;
          const closed = s.status === "CLOSED";
          return (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <span className="font-medium">{formatSession(s.startsAt)}</span>
              <span className="flex items-center gap-3 text-sm text-slate-500">
                {closed ? "Booking closed" : soldOut ? "Sold out" : `${left} seat${left === 1 ? "" : "s"} left`}
                {!closed && !soldOut && event.ticketTypes.length > 0 && (
                  <Link href={`/book/${s.id}`} className="rounded bg-slate-900 px-3 py-1 text-white">Book</Link>
                )}
              </span>
            </li>
          );
        })}
        {!event.sessions.length && <li className="px-4 py-3 text-slate-500">No upcoming dates.</li>}
      </ul>
    </main>
  );
}
