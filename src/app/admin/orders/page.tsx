import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { formatMoney, formatSession } from "@/lib/time";
import { cancelPending, markPaid } from "./actions";

export const dynamic = "force-dynamic";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole("OWNER");
  const q = (await searchParams).q?.trim();
  const now = new Date();

  const pending = await prisma.order.findMany({
    where: { status: "PENDING", paymentMethod: { in: ["VENMO", "ZELLE"] }, holdExpiresAt: { gt: now } },
    include: { session: { include: { event: true } } },
    orderBy: { createdAt: "asc" },
  });
  const recent = await prisma.order.findMany({
    where: q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { customerName: { contains: q, mode: "insensitive" } },
            { customerEmail: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    include: { session: { include: { event: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return (
    <main className="mx-auto max-w-4xl space-y-10 p-8">
      <section>
        <h1 className="text-2xl font-bold">Pending Venmo / Zelle payments ({pending.length})</h1>
        {!pending.length && <p className="mt-2 text-slate-500">Nothing waiting for approval.</p>}
        <ul className="mt-4 space-y-3">
          {pending.map((o) => (
            <li key={o.id} className="rounded border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span><Link href={`/admin/orders/${o.id}`} className="font-mono font-bold underline">{o.code}</Link> · {o.paymentMethod} · <b>{formatMoney(o.totalCents)}</b></span>
                <span className="text-sm text-slate-500">hold until {formatSession(o.holdExpiresAt!)}</span>
              </div>
              <p className="text-sm">{o.customerName} · {o.customerEmail} · {o.customerPhone}</p>
              <p className="text-sm text-slate-500">{o.session.event.title} · {formatSession(o.session.startsAt)}</p>
              <div className="mt-3 flex gap-2">
                <form action={markPaid}>
                  <input type="hidden" name="id" value={o.id} />
                  <button className="rounded bg-green-700 px-3 py-1.5 text-sm text-white">Mark paid</button>
                </form>
                <form action={cancelPending}>
                  <input type="hidden" name="id" value={o.id} />
                  <button className="rounded border px-3 py-1.5 text-sm">Cancel</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-xl font-bold">Orders</h2>
        <form className="mt-3 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search name, email or code" className="w-full rounded border px-3 py-2" />
          <button className="rounded border px-3 py-2">Search</button>
        </form>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr><th className="py-1">Code</th><th>Customer</th><th>Event</th><th>Method</th><th>Total</th><th>Status</th></tr>
          </thead>
          <tbody>
            {recent.map((o) => (
              <tr key={o.id} className="border-t">
                <td className="py-1.5 font-mono"><Link href={`/admin/orders/${o.id}`} className="underline">{o.code}</Link></td>
                <td>{o.customerName}</td>
                <td>{o.session.event.title} · {formatSession(o.session.startsAt)}</td>
                <td>{o.paymentMethod}</td>
                <td>{formatMoney(o.totalCents)}</td>
                <td>{o.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
