import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { seatsTakenBySession } from "@/lib/capacity";
import { EVENT_TZ, formatMoney, formatSession } from "@/lib/time";
import { SlotFields } from "./SlotFields";
import {
  addSession,
  addTicketType,
  deleteSession,
  deleteTicketType,
  generateSessions,
  setSessionStatus,
  updateCapacity,
  updateEvent,
} from "../actions";

export const dynamic = "force-dynamic";

const input = "w-full rounded border px-3 py-2";
const btn = "rounded border px-2 py-1 text-xs hover:bg-slate-50";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function EditEvent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireRole("OWNER");
  const { id } = await params;
  const { error, saved } = await searchParams;
  const event = await prisma.event.findUnique({
    where: { id },
    include: { ticketTypes: { orderBy: { sortOrder: "asc" } }, sessions: { orderBy: { startsAt: "asc" } } },
  });
  if (!event) notFound();
  const taken = await seatsTakenBySession(event.sessions.map((s) => s.id));
  const canAddSingle = event.type === "RECURRING" || event.sessions.length === 0;

  return (
    <main className="mx-auto max-w-3xl space-y-10 p-8">
      <div>
        <Link href="/admin/events" className="text-sm text-slate-500">← Events</Link>
        <h1 className="mt-1 text-2xl font-bold">{event.title}</h1>
        {event.status === "PUBLISHED" && (
          <Link href={`/events/${event.slug}`} className="text-sm text-blue-600">View public page</Link>
        )}
      </div>

      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">{saved}</p>}

      <section>
        <h2 className="text-lg font-semibold">Details</h2>
        <form action={updateEvent} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={event.id} />
          <input name="title" defaultValue={event.title} required className={input} />
          <textarea name="description" defaultValue={event.description} rows={4} className={input} />
          <input name="location" defaultValue={event.location} placeholder="Location" className={input} />
          <div className="flex gap-3">
            <select name="type" defaultValue={event.type} className={input}>
              <option value="ONE_OFF">One-off event</option>
              <option value="RECURRING">Recurring activity</option>
            </select>
            <select name="status" defaultValue={event.status} className={input}>
              <option value="DRAFT">Draft (hidden)</option>
              <option value="PUBLISHED">Published</option>
              <option value="ARCHIVED">Archived (hidden)</option>
            </select>
          </div>
          <button className="rounded bg-slate-900 px-4 py-2 text-white">Save</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Ticket types</h2>
        <ul className="mt-3 divide-y rounded border">
          {event.ticketTypes.map((t) => (
            <li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span>
                {t.name} · {formatMoney(t.priceCents)}
                {t.cap != null && <span className="text-slate-500"> · max {t.cap} per session</span>}
              </span>
              <form action={deleteTicketType}>
                <input type="hidden" name="id" value={t.id} />
                <button className={btn}>Delete</button>
              </form>
            </li>
          ))}
          {!event.ticketTypes.length && <li className="px-4 py-3 text-sm text-slate-500">None yet. Add at least one to sell tickets.</li>}
        </ul>
        <form action={addTicketType} className="mt-3 flex gap-2">
          <input type="hidden" name="eventId" value={event.id} />
          <input name="name" placeholder="Name (Adult)" required className={input} />
          <input name="price" type="number" step="0.01" min="0" placeholder="Price $" required className={input} />
          <input name="cap" type="number" min="1" placeholder="Cap (optional)" className={input} />
          <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Add</button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Sessions <span className="text-sm font-normal text-slate-500">(times in {EVENT_TZ})</span></h2>
        <ul className="mt-3 divide-y rounded border">
          {event.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
              <span className="min-w-44 font-medium">{formatSession(s.startsAt)}</span>
              <span className="text-slate-500">{taken.get(s.id) ?? 0} / {s.capacity} taken</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{s.status}</span>
              <span className="ml-auto flex items-center gap-2">
                <form action={updateCapacity} className="flex gap-1">
                  <input type="hidden" name="id" value={s.id} />
                  <input name="capacity" type="number" min="1" defaultValue={s.capacity} className="w-20 rounded border px-2 py-1 text-xs" />
                  <button className={btn}>Set</button>
                </form>
                {(["OPEN", "CLOSED", "CANCELLED"] as const)
                  .filter((st) => st !== s.status)
                  .map((st) => (
                    <form key={st} action={setSessionStatus}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="status" value={st} />
                      <button className={btn}>{st === "OPEN" ? "Reopen" : st === "CLOSED" ? "Close" : "Cancel"}</button>
                    </form>
                  ))}
                <form action={deleteSession}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className={btn}>Delete</button>
                </form>
              </span>
            </li>
          ))}
          {!event.sessions.length && <li className="px-4 py-3 text-sm text-slate-500">No sessions yet.</li>}
        </ul>

        {canAddSingle && (
          <form action={addSession} className="mt-4 flex flex-wrap gap-2">
            <input type="hidden" name="eventId" value={event.id} />
            <input name="startsAt" type="datetime-local" required className={`${input} max-w-60`} />
            <input name="capacity" type="number" min="1" placeholder="Capacity" required className={`${input} max-w-32`} />
            <input name="durationMinutes" type="number" min="0" placeholder="Minutes (optional)" className={`${input} max-w-44`} />
            <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Add session</button>
          </form>
        )}

        {event.type === "RECURRING" && (
          <form action={generateSessions} className="mt-6 space-y-3 rounded border p-4">
            <h3 className="font-medium">Generate from a schedule</h3>
            <input type="hidden" name="eventId" value={event.id} />
            <div className="flex flex-wrap gap-3 text-sm">
              {DAYS.map((d, i) => (
                <label key={d} className="flex items-center gap-1">
                  <input type="checkbox" name="days" value={i} /> {d}
                </label>
              ))}
            </div>
            <SlotFields />
            <div className="flex flex-wrap gap-3">
              <label className="text-sm">From <input name="startDate" type="date" required className="rounded border px-2 py-1" /></label>
              <label className="text-sm">To <input name="endDate" type="date" required className="rounded border px-2 py-1" /></label>
              <input name="capacity" type="number" min="1" placeholder="Capacity" required className={`${input} max-w-32`} />
            </div>
            <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white">Generate sessions</button>
            <p className="text-xs text-slate-500">Existing sessions at the same time are skipped.</p>
          </form>
        )}
      </section>
    </main>
  );
}
