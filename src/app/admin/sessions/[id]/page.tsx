import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { formatSession } from "@/lib/time";
import { checkInManual, undoCheckIn } from "../actions";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function GuestListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireRole("OWNER", "STAFF");
  const { id } = await params;
  const q = (await searchParams).q?.trim();

  const session = await prisma.session.findUnique({ where: { id }, include: { event: true } });
  if (!session) notFound();

  const all = await prisma.ticket.findMany({
    where: { order: { sessionId: id, status: "PAID" }, status: { not: "VOID" } },
    include: { order: true, ticketType: true },
    orderBy: [{ order: { customerName: "asc" } }, { createdAt: "asc" }],
  });
  const needle = q?.toLowerCase();
  const tickets = needle
    ? all.filter((t) => [t.order.customerName, t.order.customerEmail, t.order.code].some((v) => v.toLowerCase().includes(needle)))
    : all;
  const checkedIn = all.filter((t) => t.status === "CHECKED_IN").length;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href="/admin" className="text-sm text-slate-500 print:hidden">← Admin</Link>
      <h1 className="mt-2 text-2xl font-bold">{session.event.title}</h1>
      <p className="text-slate-600">{formatSession(session.startsAt)} · {checkedIn} of {all.length} checked in</p>

      <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/admin/sessions/${id}/scan`} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Scan tickets</Link>
        <a href={`/admin/sessions/${id}/csv`} className="rounded border px-3 py-1.5 text-sm">Export CSV</a>
        <PrintButton />
        <form className="ml-auto flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search name, email or code" className="rounded border px-3 py-1.5 text-sm" />
          <button className="rounded border px-3 py-1.5 text-sm">Search</button>
        </form>
      </div>

      <table className="mt-6 w-full text-left text-sm">
        <thead className="text-slate-500">
          <tr><th className="py-1">Guest</th><th>Ticket</th><th>Contact</th><th>Paid by</th><th>Checked in</th></tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} className="border-t align-top">
              <td className="py-2"><span className="font-medium">{t.order.customerName}</span><br /><span className="font-mono text-xs text-slate-500">{t.order.code}</span></td>
              <td>{t.ticketType.name}</td>
              <td>{t.order.customerPhone}<br /><span className="text-slate-500">{t.order.customerEmail}</span></td>
              <td>{t.order.paymentMethod}</td>
              <td>
                {t.status === "CHECKED_IN" ? (
                  <span className="flex items-center gap-2">
                    <span className="text-green-700">✓ {t.checkedInAt?.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}</span>
                    {user.role === "OWNER" && (
                      <form action={undoCheckIn} className="print:hidden">
                        <input type="hidden" name="sessionId" value={id} />
                        <input type="hidden" name="ticketId" value={t.id} />
                        <button className="text-xs text-slate-500 underline">undo</button>
                      </form>
                    )}
                  </span>
                ) : (
                  <form action={checkInManual} className="print:hidden">
                    <input type="hidden" name="sessionId" value={id} />
                    <input type="hidden" name="ticketId" value={t.id} />
                    <button className="rounded border px-2 py-1 text-xs">Check in</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
          {!tickets.length && <tr><td colSpan={5} className="py-6 text-slate-500">No guests{q ? " match that search" : " yet"}.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
