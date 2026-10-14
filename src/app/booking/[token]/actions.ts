"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { rateLimited } from "@/lib/ratelimit";
import { getSettings } from "@/lib/orders";
import { ChangeError, rescheduleOrder } from "@/lib/changes";
import { sendOwnerNotice } from "@/lib/email";

function back(token: string, key: "error" | "saved", message: string): never {
  revalidatePath(`/booking/${token}`);
  redirect(`/booking/${token}?${key}=${encodeURIComponent(message)}`);
}

/** The secret link is the credential. Returns the order only while changes are still allowed by the policy. */
async function editableOrder(token: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(`booking-change:${ip}`, 20, 10 * 60_000)) back(token, "error", "Too many attempts. Please wait a few minutes.");

  const order = await prisma.order.findUnique({ where: { accessToken: token }, include: { session: true } });
  if (!order || order.status !== "PAID") back(token, "error", "This booking can't be changed.");
  const settings = await getSettings();
  const cutoff = order.session.startsAt.getTime() - settings.refundCutoffHours * 3_600_000;
  if (Date.now() > cutoff) {
    back(token, "error", `Changes are only allowed up to ${settings.refundCutoffHours} hours before the event. Please contact us.`);
  }
  return order;
}

export async function selfReschedule(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const order = await editableOrder(token);
  const newSessionId = String(fd.get("sessionId") ?? "");
  if (!newSessionId) back(token, "error", "Pick a new time.");
  try {
    await rescheduleOrder({ orderId: order.id, newSessionId });
  } catch (e) {
    if (e instanceof ChangeError) back(token, "error", e.message);
    throw e;
  }
  back(token, "saved", "Your booking was moved. New tickets are on this page and in your email.");
}

/** Customers can't trigger refunds themselves: this tells the owner, who decides and refunds. */
export async function requestCancel(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const order = await editableOrder(token);
  const already = await prisma.auditLog.count({ where: { action: "CANCEL_REQUESTED", entity: "Order", entityId: order.id } });
  if (!already) {
    await prisma.auditLog.create({ data: { action: "CANCEL_REQUESTED", entity: "Order", entityId: order.id } });
    await sendOwnerNotice(
      `Cancellation request: ${order.code}`,
      `${order.customerName} (${order.customerEmail}) asked to cancel order ${order.code}.`,
    );
  }
  back(token, "saved", "We've received your cancellation request and will get back to you shortly.");
}
