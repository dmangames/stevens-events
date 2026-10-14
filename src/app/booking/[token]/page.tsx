import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/orders";
import { reconcileStripeOrder } from "@/lib/reconcile";
import { qrDataUrl } from "@/lib/qr";
import { formatMoney, formatSession } from "@/lib/time";
import { requestCancel, selfReschedule } from "./actions";

export const dynamic = "force-dynamic";

// Secure "My booking" link: the unguessable token is the credential, so no login is needed.
// Customers can reschedule themselves (within the policy window) or ask to cancel.
export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { token } = await params;
  const { error, saved } = await searchParams;
  const found = await prisma.order.findUnique({ where: { accessToken: token }, select: { id: true, status: true, paymentMethod: true } });
  if (found?.status === "PENDING" && found.paymentMethod === "STRIPE") await reconcileStripeOrder(found.id);
  const order = await prisma.order.findUnique({
    where: { accessToken: token },
    include: { items: { include: { ticketType: true } }, session: { include: { event: true } }, tickets: { include: { ticketType: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!order) notFound();

  // Voided tickets (after a reschedule or cancellation) are hidden: only live tickets matter to the customer.
  const tickets = order.tickets.filter((t) => t.status !== "VOID");
  const qrs = order.status === "PAID" ? await Promise.all(tickets.map((t) => qrDataUrl(t.qrToken))) : [];
  // Stop auto-refreshing once the hold has lapsed so the page can't poll forever.
  const settings = await getSettings();
  const manualPending = order.status === "PENDING" && order.paymentMethod !== "STRIPE" && !!order.holdExpiresAt && order.holdExpiresAt > new Date();
  const changeable =
    order.status === "PAID" && !tickets.some((t) => t.status === "CHECKED_IN") &&
    Date.now() <= order.session.startsAt.getTime() - settings.refundCutoffHours * 3_600_000;
  const otherSessions = changeable
    ? await prisma.session.findMany({
        where: { eventId: order.session.eventId, id: { not: order.sessionId }, status: "OPEN", startsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 60,
      })
    : [];
  const cancelRequested = changeable
    ? (await prisma.auditLog.count({ where: { action: "CANCEL_REQUESTED", entity: "Order", entityId: order.id } })) > 0
    : false;
  const waiting = order.status === "PENDING" && order.paymentMethod === "STRIPE" && !!order.holdExpiresAt && order.holdExpiresAt > new Date();

  return (
    <main className="mx-auto max-w-xl p-8">
      {waiting && <meta httpEquiv="refresh" content="3" />}
      <h1 className="text-2xl font-bold">{order.session.event.title}</h1>
      <p className="text-slate-600">{formatSession(order.session.startsAt)}</p>

      <p className="mt-6 rounded bg-slate-50 p-4">
        {order.status === "PAID" && <>Confirmed. Your {tickets.length} ticket{tickets.length === 1 ? "" : "s"} {tickets.length === 1 ? "is" : "are"} booked.</>}
        {waiting && <>Confirming your payment…</>}
        {order.status === "PENDING" && !waiting && (order.paymentMethod === "STRIPE"
          ? <>We haven&apos;t received your payment. If you were charged, refresh this page in a minute or contact us with code {order.code}.</>
          : <>We&apos;re waiting for your payment.</>)}
        {order.status === "EXPIRED" && <>This reservation expired.</>}
        {order.status === "CANCELLED" && <>This booking was cancelled.</>}
        {order.status === "REFUNDED" && <>This booking was cancelled and refunded.</>}
      </p>
      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800">{saved}</p>}

      {manualPending && (
        <div className="mt-4 space-y-2 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-semibold">Complete your payment to confirm your seats</p>
          <p>Send <b>{formatMoney(order.totalCents)}</b> via{" "}
            {order.paymentMethod === "VENMO"
              ? <a className="underline" href={`https://venmo.com/${settings.venmoHandle.replace(/^@/, "")}`}>Venmo {settings.venmoHandle}</a>
              : <>Zelle to <b>{settings.zelleContact}</b></>}.</p>
          <p>Put this code in the payment note: <span className="font-mono text-base font-bold">{order.code}</span></p>
          <p>Your seats are held until <b>{formatSession(order.holdExpiresAt!)}</b>. We&apos;ll email your tickets once we confirm your payment.</p>
        </div>
      )}

      <p className="mt-4 text-sm text-slate-500">Order code <span className="font-mono font-semibold text-slate-900">{order.code}</span></p>
      <ul className="mt-4 text-sm">
        {order.items.map((i) => (
          <li key={i.id}>{i.quantity} × {i.ticketType.name} · {formatMoney(i.unitCents * i.quantity)}</li>
        ))}
        {order.feeCents > 0 && <li>Booking fee · {formatMoney(order.feeCents)}</li>}
        <li className="font-semibold">Total {formatMoney(order.totalCents)}</li>
        {order.refundedCents > 0 && <li>Refunded {formatMoney(order.refundedCents)}</li>}
      </ul>

      {tickets.map((t, i) => (
        <div key={t.id} className="mt-6 rounded border p-4 text-center">
          <p className="text-sm font-medium">Ticket {i + 1} of {tickets.length} · {t.ticketType.name}</p>
          {t.status === "VALID" && qrs[i] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrs[i]} alt={`Ticket ${i + 1} QR code`} width={220} height={220} className="mx-auto mt-2" />
          )}
          {t.status === "CHECKED_IN" && <p className="mt-2 font-semibold text-amber-600">Already checked in</p>}
        </div>
      ))}

      {changeable && (
        <section className="mt-10 space-y-6 border-t pt-6">
          <h2 className="text-lg font-semibold">Change your booking</h2>
          {settings.refundPolicyText && <p className="whitespace-pre-line text-sm text-slate-600">{settings.refundPolicyText}</p>}
          {otherSessions.length > 0 && (
            <form action={selfReschedule} className="flex flex-wrap gap-3">
              <input type="hidden" name="token" value={token} />
              <select name="sessionId" required defaultValue="" className="rounded border px-3 py-2">
                <option value="" disabled>Move to another time…</option>
                {otherSessions.map((s) => <option key={s.id} value={s.id}>{formatSession(s.startsAt)}</option>)}
              </select>
              <button className="rounded border px-3 py-2 text-sm">Reschedule</button>
            </form>
          )}
          {cancelRequested ? (
            <p className="text-sm text-slate-600">Your cancellation request has been sent. We&apos;ll be in touch.</p>
          ) : (
            <form action={requestCancel}>
              <input type="hidden" name="token" value={token} />
              <button className="rounded border border-red-300 px-3 py-2 text-sm text-red-700">Ask to cancel</button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
