import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { lockSession, seatsTakenBySession, seatsTakenByType } from "@/lib/capacity";
import { sendConfirmationEmail, sendOrderNotice } from "@/lib/email";
import { formatMoney } from "@/lib/time";

export class ChangeError extends Error {}

/**
 * Refunds some or all of a PAID order and/or cancels it.
 * - Card orders are refunded through the Stripe API; Venmo/Zelle refunds are only recorded
 *   (the owner sends the money back by hand).
 * - `cancel` voids the tickets and frees the seats; without it the booking stays valid (partial refund).
 */
export async function refundOrder(args: { orderId: string; amountCents: number; cancel: boolean; actorId: string }) {
  const order = await prisma.order.findUnique({ where: { id: args.orderId } });
  if (!order) throw new ChangeError("Order not found.");
  if (order.status !== "PAID") throw new ChangeError("Only paid orders can be refunded.");
  const remaining = order.totalCents - order.refundedCents;
  if (!Number.isInteger(args.amountCents) || args.amountCents < 0 || args.amountCents > remaining) {
    throw new ChangeError(`Refund must be between $0.00 and ${formatMoney(remaining)}.`);
  }
  if (args.amountCents === 0 && !args.cancel) throw new ChangeError("Enter an amount to refund, or choose to cancel the booking.");

  if (args.amountCents > 0 && order.paymentMethod === "STRIPE") {
    if (!order.stripePaymentIntentId) throw new ChangeError("This order has no Stripe payment on record.");
    // Same order + same running total + same amount = same key, so a double-click can't refund twice.
    await stripe().refunds.create(
      { payment_intent: order.stripePaymentIntentId, amount: args.amountCents },
      { idempotencyKey: `refund-${order.id}-${order.refundedCents}-${args.amountCents}` },
    );
  }

  const newRefunded = order.refundedCents + args.amountCents;
  const done = await prisma.$transaction(async (tx) => {
    // Conditional on the running total we read, so two simultaneous refunds can't both be recorded.
    const res = await tx.order.updateMany({
      where: { id: order.id, status: "PAID", refundedCents: order.refundedCents },
      data: {
        refundedCents: newRefunded,
        ...(args.cancel ? { status: newRefunded > 0 ? "REFUNDED" : "CANCELLED" } : {}),
      },
    });
    if (res.count === 0) return false;
    if (args.cancel) await tx.ticket.updateMany({ where: { orderId: order.id, status: { not: "VOID" } }, data: { status: "VOID" } });
    await tx.auditLog.create({
      data: {
        action: args.cancel ? "ORDER_CANCELLED_REFUNDED" : "ORDER_PARTIAL_REFUND",
        entity: "Order",
        entityId: order.id,
        userId: args.actorId,
        meta: { amountCents: args.amountCents, method: order.paymentMethod, manual: order.paymentMethod !== "STRIPE" },
      },
    });
    return true;
  });
  if (!done) throw new ChangeError("This order changed while you were working. Reload and try again.");

  const how = order.paymentMethod === "STRIPE" ? "to your original payment method" : "by Venmo/Zelle";
  const parts = [
    args.amountCents > 0 ? `We've refunded ${formatMoney(args.amountCents)} ${how}.` : "",
    args.cancel ? "Your booking has been cancelled and your tickets are no longer valid." : "",
  ].filter(Boolean);
  await sendOrderNotice(order.id, args.cancel ? "Your booking was cancelled" : "A refund was issued", parts.join(" "));
}

/**
 * Moves a PAID order to another session of the same event. Old tickets are voided and new ones issued
 * (new QR codes), inside one transaction holding a row lock on the target session.
 */
export async function rescheduleOrder(args: { orderId: string; newSessionId: string; actorId?: string | null }) {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: args.orderId },
      include: { items: true, tickets: true, session: true },
    });
    if (!order || order.status !== "PAID") throw new ChangeError("Only paid bookings can be rescheduled.");
    if (order.sessionId === args.newSessionId) throw new ChangeError("Pick a different time.");
    if (order.tickets.some((t) => t.status === "CHECKED_IN")) throw new ChangeError("Some tickets are already checked in.");

    await lockSession(tx, args.newSessionId);
    const target = await tx.session.findUnique({ where: { id: args.newSessionId }, include: { event: { include: { ticketTypes: true } } } });
    if (!target || target.eventId !== order.session.eventId) throw new ChangeError("That time isn't available for this event.");
    if (target.status !== "OPEN" || target.startsAt <= new Date()) throw new ChangeError("That time is closed for booking.");

    const seats = order.items.reduce((n, i) => n + i.quantity, 0);
    const taken = (await seatsTakenBySession([target.id], tx)).get(target.id) ?? 0;
    if (taken + seats > target.capacity) throw new ChangeError("Not enough seats left at that time.");
    const byType = await seatsTakenByType(target.id, tx);
    for (const i of order.items) {
      const t = target.event.ticketTypes.find((x) => x.id === i.ticketTypeId);
      if (t?.cap != null && (byType.get(t.id) ?? 0) + i.quantity > t.cap) throw new ChangeError(`Not enough ${t.name} tickets left at that time.`);
    }

    await tx.ticket.updateMany({ where: { orderId: order.id, status: { not: "VOID" } }, data: { status: "VOID" } });
    await tx.order.update({ where: { id: order.id }, data: { sessionId: target.id, confirmationSentAt: null } });
    await tx.ticket.createMany({
      data: order.items.flatMap((i) =>
        Array.from({ length: i.quantity }, () => ({ orderId: order.id, ticketTypeId: i.ticketTypeId, qrToken: randomBytes(32).toString("base64url") })),
      ),
    });
    await tx.auditLog.create({
      data: {
        action: "ORDER_RESCHEDULED",
        entity: "Order",
        entityId: order.id,
        userId: args.actorId ?? null,
        meta: { from: order.sessionId, to: target.id },
      },
    });
    return order.id;
  });
  await sendConfirmationEmail(result, { force: true, subject: "Your booking was rescheduled - new tickets" });
}
