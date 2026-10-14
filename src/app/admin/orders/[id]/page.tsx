import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { getSettings } from "@/lib/orders";
import { formatMoney, formatSession } from "@/lib/time";
import { refund, reschedule, resendTickets } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  await requireRole("OWNER");
  const { id } = await params;
  const { error, saved } = await searchParams;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { include: { ticketType: true } }, tickets: true, session: { include: { event: true } } },
  });
  if (!order) notFound();

  const settings = await getSettings();
  const remaining = order.totalCents - order.refundedCents;
  // Default refund: everything, or everything except the booking fee when fees are non-refundable.
  const suggested = Math.max(0, Math.min(remaining, (settings.feeRefundable ? order.totalCents : order.subtotalCents) - order.refundedCents));
  const others = order.status === "PAID"
    ? await prisma.session.findMany({
        where: { eventId: order.session.eventId, id: { not: order.sessionId }, status: "OPEN", startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 100,
      })
    : [];
  const input = "rounded border px-3 py-2";

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <Link href="/admin/orders" className="text-sm text-slate-500">← Orders</Link>
      <div>
        <h1 className="text-2xl font-bold"><span className="font-mono">{order.code}</span> · {order.status}</h1>
        <p className="text-slate-600">{order.session.event.title} · {formatSession(order.session.startsAt)}</p>
      </div>
      {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">{saved}</p>}

      <section className="text-sm">
        <p>{order.customerName} · {order.customerEmail} · {order.customerPhone}</p>
        {order.notes && <p className="text-slate-500">Notes: {order.notes}</p>}
        <ul className="mt-3">
          {order.items.map((i) => <li key={i.id}>{i.quantity} × {i.ticketType.name} · {formatMoney(i.unitCents * i.quantity)}</li>)}
          {order.feeCents > 0 && <li>Booking fee · {formatMoney(order.feeCents)}</li>}
          <li className="font-semibold">Total {formatMoney(order.totalCents)} via {order.paymentMethod}</li>
          {order.refundedCents > 0 && <li className="text-red-700">Refunded {formatMoney(order.refundedCents)}</li>}
        </ul>
        <p className="mt-2 text-slate-500">
          Tickets: {order.tickets.filter((t) => t.status === "VALID").length} valid,{" "}
          {order.tickets.filter((t) => t.status === "CHECKED_IN").length} checked in,{" "}
          {order.tickets.filter((t) => t.status === "VOID").length} void
        </p>
      </section>

      {order.status === "PAID" && (
        <>
          <section className="rounded border p-4">
            <h2 className="font-semibold">Refund / cancel</h2>
            <p className="mt-1 text-sm text-slate-500">
              {order.paymentMethod === "STRIPE"
                ? "The refund goes back to the customer's card through Stripe."
                : "Venmo/Zelle: this only records the refund. Send the money back yourself."}{" "}
              Up to {formatMoney(remaining)} can still be refunded.
              {!settings.feeRefundable && order.feeCents > 0 && " The suggested amount leaves out the booking fee (per Settings)."}
            </p>
            <form action={refund} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={order.id} />
              <label className="text-sm">$ <input name="amount" type="number" step="0.01" min="0" max={remaining / 100} defaultValue={(suggested / 100).toFixed(2)} className={`${input} w-28`} /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="cancel" defaultChecked /> Cancel the booking (void tickets, free the seats)</label>
              <button className="rounded bg-red-700 px-3 py-2 text-sm text-white">Refund</button>
            </form>
          </section>

          <section className="rounded border p-4">
            <h2 className="font-semibold">Reschedule</h2>
            <p className="mt-1 text-sm text-slate-500">Old QR codes stop working and new tickets are emailed. Capacity is checked.</p>
            <form action={reschedule} className="mt-3 flex flex-wrap gap-3">
              <input type="hidden" name="id" value={order.id} />
              <select name="sessionId" className={input} required defaultValue="">
                <option value="" disabled>Choose a time…</option>
                {others.map((s) => <option key={s.id} value={s.id}>{formatSession(s.startsAt)}</option>)}
              </select>
              <button className="rounded border px-3 py-2 text-sm">Move booking</button>
            </form>
          </section>

          <form action={resendTickets}>
            <input type="hidden" name="id" value={order.id} />
            <button className="rounded border px-3 py-2 text-sm">Resend tickets</button>
          </form>
        </>
      )}
    </main>
  );
}
