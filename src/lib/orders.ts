import { randomBytes, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { lockSession, seatsTakenBySession, seatsTakenByType } from "@/lib/capacity";

export class BookingError extends Error {}

// No 0/O/1/I so codes are easy to read out or type from a payment memo.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => "SE-" + Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
const newToken = () => randomBytes(32).toString("base64url");

export async function getSettings() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export type Selection = { ticketTypeId: string; quantity: number }[];

export type CustomerInput = { name: string; email: string; phone: string; notes?: string };

/** Booking fee in cents. Percent is stored as a Decimal(5,2); work in basis points to avoid float drift. */
export function bookingFeeCents(subtotalCents: number, percent: Prisma.Decimal | number) {
  const bps = Math.round(Number(percent) * 100);
  return Math.round((subtotalCents * bps) / 10_000);
}

/**
 * Reserves seats and creates a PENDING order. Prices come from the database, never the browser.
 * Runs in one transaction holding a row lock on the Session, so the last seat can't be sold twice.
 */
export async function createPendingOrder(args: {
  sessionId: string;
  selection: Selection;
  customer: CustomerInput;
  method: "STRIPE" | "VENMO" | "ZELLE";
}) {
  const settings = await getSettings();
  const selection = args.selection.filter((s) => s.quantity > 0);
  if (!selection.length) throw new BookingError("Choose at least one ticket.");
  const seats = selection.reduce((n, s) => n + s.quantity, 0);
  if (seats > 50) throw new BookingError("Please contact us to book more than 50 tickets.");

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockSession(tx, args.sessionId);
        const session = await tx.session.findUnique({
          where: { id: args.sessionId },
          include: { event: { include: { ticketTypes: true } } },
        });
        if (!session || session.event.status !== "PUBLISHED") throw new BookingError("This event isn't available.");
        if (session.status !== "OPEN" || session.startsAt <= new Date()) {
          throw new BookingError("Booking for this time is closed.");
        }

        const types = new Map(session.event.ticketTypes.map((t) => [t.id, t]));
        const takenTotal = (await seatsTakenBySession([session.id], tx)).get(session.id) ?? 0;
        if (takenTotal + seats > session.capacity) {
          const left = Math.max(0, session.capacity - takenTotal);
          throw new BookingError(left === 0 ? "Sorry, this time is sold out." : `Only ${left} seat${left === 1 ? "" : "s"} left.`);
        }
        const takenByType = await seatsTakenByType(session.id, tx);

        let subtotal = 0;
        const items = selection.map((s) => {
          const t = types.get(s.ticketTypeId);
          if (!t) throw new BookingError("Invalid ticket type.");
          if (t.cap != null && (takenByType.get(t.id) ?? 0) + s.quantity > t.cap) {
            throw new BookingError(`Not enough ${t.name} tickets left.`);
          }
          subtotal += t.priceCents * s.quantity;
          return { ticketTypeId: t.id, quantity: s.quantity, unitCents: t.priceCents };
        });

        const applyFee = args.method === "STRIPE" || settings.feeAppliesToManual;
        const fee = applyFee ? bookingFeeCents(subtotal, settings.bookingFeePercent) : 0;
        const holdMinutes = args.method === "STRIPE" ? settings.holdMinutesCard : settings.holdMinutesManual;

        const order = await tx.order.create({
          data: {
            code: newCode(),
            accessToken: newToken(),
            sessionId: session.id,
            customerName: args.customer.name,
            customerEmail: args.customer.email.toLowerCase(),
            customerPhone: args.customer.phone,
            notes: args.customer.notes || null,
            subtotalCents: subtotal,
            feeCents: fee,
            totalCents: subtotal + fee,
            paymentMethod: args.method,
            holdExpiresAt: new Date(Date.now() + holdMinutes * 60_000),
            items: { create: items },
          },
          include: { items: { include: { ticketType: true } }, session: { include: { event: true } } },
        });
        return order;
      });
    } catch (e) {
      // Order code collision (unique violation) - retry with a fresh code.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 4) continue;
      throw e;
    }
  }
}

export type FulfilResult = "paid" | "already-paid" | "needs-refund" | "not-found";

/**
 * Marks an order PAID and issues one ticket per seat. Safe to call repeatedly (webhooks can arrive twice):
 * the status change is a conditional update, so only one caller issues tickets.
 *
 * If the hold already lapsed (EXPIRED) the seats are re-claimed when they're still free; otherwise
 * the caller must refund ("needs-refund").
 */
export async function fulfilPaidOrder(
  orderId: string,
  payment: { stripePaymentIntentId?: string | null; actorId?: string | null } = {},
): Promise<FulfilResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) return "not-found";
    if (order.status === "PAID") return "already-paid";

    await lockSession(tx, order.sessionId);
    // A hold that lapsed or was cancelled can still be honoured if the seats are free.
    if (order.status === "EXPIRED" || order.status === "CANCELLED") {
      const session = await tx.session.findUniqueOrThrow({ where: { id: order.sessionId } });
      const seats = order.items.reduce((n, i) => n + i.quantity, 0);
      const taken = (await seatsTakenBySession([order.sessionId], tx, order.id)).get(order.sessionId) ?? 0;
      if (session.status === "CANCELLED" || taken + seats > session.capacity) return "needs-refund";
    }
    if (order.status === "REFUNDED") return "needs-refund";

    const flipped = await tx.order.updateMany({
      where: { id: orderId, status: { in: ["PENDING", "EXPIRED", "CANCELLED"] } },
      data: {
        status: "PAID",
        holdExpiresAt: null,
        ...(payment.stripePaymentIntentId ? { stripePaymentIntentId: payment.stripePaymentIntentId } : {}),
      },
    });
    if (flipped.count === 0) return "already-paid";

    const existing = await tx.ticket.count({ where: { orderId } });
    if (existing === 0) {
      await tx.ticket.createMany({
        data: order.items.flatMap((i) =>
          Array.from({ length: i.quantity }, () => ({
            orderId,
            ticketTypeId: i.ticketTypeId,
            qrToken: randomBytes(32).toString("base64url"),
          })),
        ),
      });
    }
    await tx.auditLog.create({
      data: {
        action: "ORDER_PAID",
        entity: "Order",
        entityId: orderId,
        userId: payment.actorId ?? null,
        meta: { method: order.paymentMethod },
      },
    });
    return "paid";
  });
}

/** Releases seats held by PENDING orders whose hold has lapsed. The capacity check already ignores them; this tidies the status. */
export async function expireLapsedHolds() {
  const res = await prisma.order.updateMany({
    where: { status: "PENDING", holdExpiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return res.count;
}
