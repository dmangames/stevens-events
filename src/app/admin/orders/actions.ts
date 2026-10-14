"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { fulfilPaidOrder } from "@/lib/orders";
import { sendConfirmationEmail } from "@/lib/email";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Venmo/Zelle: the owner has seen the money arrive. Issues tickets and emails them. */
export async function markPaid(fd: FormData) {
  const user = await requireRole("OWNER");
  const id = str(fd, "id");
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  if (order.paymentMethod === "STRIPE") return; // card orders are confirmed by the Stripe webhook only
  const result = await fulfilPaidOrder(id, { actorId: user.id });
  if (result === "paid") await sendConfirmationEmail(id);
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}

/** Cancels an unpaid order and frees its seats. */
export async function cancelPending(fd: FormData) {
  const user = await requireRole("OWNER");
  const id = str(fd, "id");
  const res = await prisma.order.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", holdExpiresAt: null } });
  if (res.count) {
    await prisma.auditLog.create({ data: { action: "ORDER_CANCELLED", entity: "Order", entityId: id, userId: user.id } });
  }
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
}
