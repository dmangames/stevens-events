import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

/** Orders that currently occupy seats: PAID, or PENDING with an unexpired hold. */
export function activeOrderWhere(): Prisma.OrderWhereInput {
  return { OR: [{ status: "PAID" }, { status: "PENDING", holdExpiresAt: { gt: new Date() } }] };
}

/**
 * Seats taken = tickets in PAID orders + tickets in PENDING orders whose hold hasn't expired.
 * Checkout re-checks this inside a transaction holding a row lock on the Session.
 */
export async function seatsTakenBySession(sessionIds: string[], db: Db = prisma, excludeOrderId?: string) {
  const taken = new Map<string, number>(sessionIds.map((id) => [id, 0]));
  if (!sessionIds.length) return taken;
  const items = await db.orderItem.findMany({
    where: {
      order: { sessionId: { in: sessionIds }, ...activeOrderWhere(), ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) },
    },
    select: { quantity: true, order: { select: { sessionId: true } } },
  });
  for (const i of items) taken.set(i.order.sessionId, (taken.get(i.order.sessionId) ?? 0) + i.quantity);
  return taken;
}

/** Seats taken per ticket type for one session (for per-type caps). */
export async function seatsTakenByType(sessionId: string, db: Db = prisma, excludeOrderId?: string) {
  const items = await db.orderItem.findMany({
    where: { order: { sessionId, ...activeOrderWhere(), ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}) } },
    select: { quantity: true, ticketTypeId: true },
  });
  const byType = new Map<string, number>();
  for (const i of items) byType.set(i.ticketTypeId, (byType.get(i.ticketTypeId) ?? 0) + i.quantity);
  return byType;
}

/** Takes a row lock on the session so concurrent buyers are serialised. Call inside a transaction. */
export async function lockSession(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
}
