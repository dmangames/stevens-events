import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function EventsAdmin() {
  await requireRole("OWNER");
  const events = await prisma.event.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { sessions: true } } },
  });
  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Events</h1>
        <Link href="/admin/events/new" className="rounded bg-slate-900 px-3 py-2 text-sm text-white">New event</Link>
      </div>
      <ul className="mt-6 divide-y rounded border">
        {events.map((e) => (
          <li key={e.id}>
            <Link href={`/admin/events/${e.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <span>
                <span className="font-medium">{e.title}</span>
                <span className="ml-2 text-sm text-slate-500">
                  {e.type === "ONE_OFF" ? "One-off" : "Recurring"} · {e._count.sessions} sessions
                </span>
              </span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{e.status}</span>
            </Link>
          </li>
        ))}
        {!events.length && <li className="px-4 py-6 text-slate-500">No events yet.</li>}
      </ul>
    </main>
  );
}
