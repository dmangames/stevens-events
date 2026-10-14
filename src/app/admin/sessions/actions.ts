"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { checkInTicket, type CheckInResult } from "@/lib/checkin";
import { rateLimited } from "@/lib/ratelimit";

/** Called by the camera scanner. Staff and owners only. */
export async function scanTicket(sessionId: string, token: string): Promise<CheckInResult> {
  const user = await requireRole("OWNER", "STAFF");
  if (rateLimited(`scan:${user.id}`, 120, 60_000)) return { status: "invalid", reason: "Too many scans, slow down" };
  const result = await checkInTicket({ qrToken: String(token).trim() }, sessionId, user.id);
  revalidatePath(`/admin/sessions/${sessionId}`);
  return result;
}

/** Manual check-in from the guest list. */
export async function checkInManual(fd: FormData) {
  const user = await requireRole("OWNER", "STAFF");
  const sessionId = String(fd.get("sessionId") ?? "");
  await checkInTicket({ id: String(fd.get("ticketId") ?? "") }, sessionId, user.id);
  revalidatePath(`/admin/sessions/${sessionId}`);
}

/** Undo a mistaken check-in. Owner only, audit-logged. */
export async function undoCheckIn(fd: FormData) {
  const user = await requireRole("OWNER");
  const sessionId = String(fd.get("sessionId") ?? "");
  const id = String(fd.get("ticketId") ?? "");
  const res = await prisma.ticket.updateMany({
    where: { id, status: "CHECKED_IN", order: { sessionId } },
    data: { status: "VALID", checkedInAt: null, checkedInById: null },
  });
  if (res.count) await prisma.auditLog.create({ data: { action: "TICKET_CHECKIN_UNDONE", entity: "Ticket", entityId: id, userId: user.id } });
  revalidatePath(`/admin/sessions/${sessionId}`);
}
