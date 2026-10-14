import { prisma } from "@/lib/db";

export type CheckInResult =
  | { status: "ok"; name: string; ticketType: string; at: string }
  | { status: "already"; name: string; ticketType: string; at: string }
  | { status: "invalid"; reason: string; name?: string };

const clock = (d: Date | null) =>
  (d ?? new Date()).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });

/**
 * Checks a ticket in. `where` picks the ticket by QR token (scanner) or id (guest list).
 * The status flip is a conditional update, so two simultaneous scans can't both succeed.
 */
export async function checkInTicket(
  where: { qrToken: string } | { id: string },
  sessionId: string,
  staffUserId: string,
): Promise<CheckInResult> {
  const ticket = await prisma.ticket.findUnique({ where, include: { order: true, ticketType: true } });
  if (!ticket) return { status: "invalid", reason: "Ticket not recognised" };

  const name = ticket.order.customerName;
  if (ticket.order.sessionId !== sessionId) return { status: "invalid", reason: "Wrong session", name };
  if (ticket.status === "VOID") return { status: "invalid", reason: "Ticket is void", name };
  if (ticket.order.status !== "PAID") return { status: "invalid", reason: `Order is ${ticket.order.status.toLowerCase()}`, name };

  const now = new Date();
  const flipped = await prisma.ticket.updateMany({
    where: { id: ticket.id, status: "VALID" },
    data: { status: "CHECKED_IN", checkedInAt: now, checkedInById: staffUserId },
  });
  if (flipped.count === 1) {
    await prisma.auditLog.create({ data: { action: "TICKET_CHECKED_IN", entity: "Ticket", entityId: ticket.id, userId: staffUserId } });
    return { status: "ok", name, ticketType: ticket.ticketType.name, at: clock(now) };
  }
  const fresh = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  if (fresh?.status === "CHECKED_IN") {
    return { status: "already", name, ticketType: ticket.ticketType.name, at: clock(fresh.checkedInAt) };
  }
  return { status: "invalid", reason: "Ticket is void", name };
}
