"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { ChangeError, refundOrder, rescheduleOrder } from "@/lib/changes";
import { sendConfirmationEmail } from "@/lib/email";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function back(id: string, key: "error" | "saved", message: string): never {
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin/orders");
  redirect(`/admin/orders/${id}?${key}=${encodeURIComponent(message)}`);
}

async function run(id: string, ok: string, fn: () => Promise<void>): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ChangeError) back(id, "error", e.message);
    // Stripe errors (already refunded, over the refundable amount, etc.) are worth showing to the owner.
    if (e instanceof Error && e.name.startsWith("Stripe")) back(id, "error", `Stripe: ${e.message}`);
    throw e;
  }
  back(id, "saved", ok);
}

export async function refund(fd: FormData) {
  const user = await requireRole("OWNER");
  const id = str(fd, "id");
  const dollars = Number(str(fd, "amount") || "0");
  if (!Number.isFinite(dollars) || dollars < 0) back(id, "error", "Enter a valid amount.");
  await run(id, "Done", () =>
    refundOrder({ orderId: id, amountCents: Math.round(dollars * 100), cancel: fd.get("cancel") === "on", actorId: user.id }),
  );
}

export async function reschedule(fd: FormData) {
  const user = await requireRole("OWNER");
  const id = str(fd, "id");
  const newSessionId = str(fd, "sessionId");
  if (!newSessionId) back(id, "error", "Pick a new time.");
  await run(id, "Rescheduled. New tickets were emailed.", () => rescheduleOrder({ orderId: id, newSessionId, actorId: user.id }));
}

export async function resendTickets(fd: FormData) {
  const user = await requireRole("OWNER");
  const id = str(fd, "id");
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order || order.status !== "PAID") back(id, "error", "Only paid orders have tickets.");
  await sendConfirmationEmail(id, { force: true });
  await prisma.auditLog.create({ data: { action: "TICKETS_RESENT", entity: "Order", entityId: id, userId: user.id } });
  back(id, "saved", `Tickets sent to ${order.customerEmail}`);
}
