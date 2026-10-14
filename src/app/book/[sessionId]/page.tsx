import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { seatsTakenBySession, seatsTakenByType } from "@/lib/capacity";
import { getSettings } from "@/lib/orders";
import { formatSession } from "@/lib/time";
import { turnstileEnabled } from "@/lib/turnstile";
import { startCheckout } from "./actions";
import { TicketPicker } from "./TicketPicker";

export const dynamic = "force-dynamic";

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { sessionId } = await params;
  const { error } = await searchParams;
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { event: { include: { ticketTypes: { orderBy: { sortOrder: "asc" } } } } },
  });
  if (!session || session.event.status !== "PUBLISHED") notFound();

  const settings = await getSettings();
  const seatsLeft = Math.max(0, session.capacity - ((await seatsTakenBySession([session.id])).get(session.id) ?? 0));
  const byType = await seatsTakenByType(session.id);
  const bookable = session.status === "OPEN" && session.startsAt > new Date() && seatsLeft > 0;
  const types = session.event.ticketTypes.map((t) => ({
    id: t.id,
    name: t.name,
    priceCents: t.priceCents,
    max: t.cap == null ? seatsLeft : Math.max(0, t.cap - (byType.get(t.id) ?? 0)),
  }));

  return (
    <main className="mx-auto max-w-xl p-8">
      <Link href={`/events/${session.event.slug}`} className="text-sm text-slate-500">← {session.event.title}</Link>
      <h1 className="mt-2 text-2xl font-bold">{session.event.title}</h1>
      <p className="text-slate-600">{formatSession(session.startsAt)}</p>
      {error && <p className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!bookable ? (
        <p className="mt-6 text-slate-600">{seatsLeft === 0 ? "Sorry, this time is sold out." : "Booking for this time is closed."}</p>
      ) : !types.length ? (
        <p className="mt-6 text-slate-600">Tickets aren&apos;t available yet.</p>
      ) : (
        <TicketPicker
          types={types}
          feePercent={Number(settings.bookingFeePercent)}
          feeAppliesToManual={settings.feeAppliesToManual}
          turnstileSiteKey={turnstileEnabled() ? process.env.TURNSTILE_SITE_KEY : undefined}
          methods={["STRIPE", ...(settings.venmoHandle ? ["VENMO"] : []), ...(settings.zelleContact ? ["ZELLE"] : [])]}
          seatsLeft={seatsLeft}
          sessionId={session.id}
          action={startCheckout}
        />
      )}
    </main>
  );
}
