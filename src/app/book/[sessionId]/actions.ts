"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rateLimited } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { BookingError, createPendingOrder, fulfilPaidOrder, getSettings } from "@/lib/orders";
import { appUrl, stripe } from "@/lib/stripe";
import { sendConfirmationEmail, sendPendingPaymentEmail } from "@/lib/email";
import { formatSession } from "@/lib/time";

const customerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().min(7).max(30),
  notes: z.string().trim().max(500).optional(),
});

function fail(sessionId: string, message: string): never {
  redirect(`/book/${sessionId}?error=${encodeURIComponent(message)}`);
}

export async function startCheckout(fd: FormData) {
  const sessionId = String(fd.get("sessionId") ?? "");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(`checkout:${ip}`, 10, 10 * 60_000)) fail(sessionId, "Too many attempts. Please wait a few minutes.");

  if (!(await verifyTurnstile(String(fd.get("cf-turnstile-response") ?? "") || null, ip))) {
    fail(sessionId, "Please complete the human check and try again.");
  }

  const customer = customerSchema.safeParse({
    name: fd.get("name"),
    email: fd.get("email"),
    phone: fd.get("phone"),
    notes: fd.get("notes") || undefined,
  });
  if (!customer.success) fail(sessionId, "Please enter a valid name, email and phone number.");

  const selection = [...fd.entries()]
    .filter(([k]) => k.startsWith("qty_"))
    .map(([k, v]) => ({ ticketTypeId: k.slice(4), quantity: Math.floor(Number(v)) }))
    .filter((s) => Number.isFinite(s.quantity) && s.quantity > 0);

  const method = z.enum(["STRIPE", "VENMO", "ZELLE"]).catch("STRIPE").parse(fd.get("method"));
  if (method !== "STRIPE") {
    const s = await getSettings();
    if (!(method === "VENMO" ? s.venmoHandle : s.zelleContact)) fail(sessionId, "That payment method isn't available.");
  }

  let order;
  try {
    order = await createPendingOrder({ sessionId, selection, customer: customer.data, method });
  } catch (e) {
    if (e instanceof BookingError) fail(sessionId, e.message);
    throw e;
  }

  // Nothing to charge (free tickets): Stripe can't process a $0 payment, so confirm directly.
  if (order.totalCents === 0) {
    await fulfilPaidOrder(order.id);
    await sendConfirmationEmail(order.id);
    redirect(`/booking/${order.accessToken}`);
  }

  // Venmo/Zelle: seats stay held while the owner confirms the payment by hand.
  if (method !== "STRIPE") {
    await sendPendingPaymentEmail(order.id);
    redirect(`/booking/${order.accessToken}`);
  }

  let url: string | null;
  try {
    const when = formatSession(order.session.startsAt);
    const checkout = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: order.customerEmail,
      client_reference_id: order.code,
      metadata: { orderId: order.id, orderCode: order.code },
      payment_intent_data: { metadata: { orderId: order.id, orderCode: order.code } },
      // Stripe requires at least 30 minutes; our own (shorter) seat hold is enforced by the database.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      line_items: [
        ...order.items.map((i) => ({
          quantity: i.quantity,
          price_data: {
            currency: "usd",
            unit_amount: i.unitCents,
            product_data: { name: `${order.session.event.title} - ${i.ticketType.name}`, description: when },
          },
        })),
        ...(order.feeCents > 0
          ? [{ quantity: 1, price_data: { currency: "usd", unit_amount: order.feeCents, product_data: { name: "Booking fee" } } }]
          : []),
      ].filter((l) => l.price_data.unit_amount > 0),
      success_url: `${appUrl()}/booking/${order.accessToken}`,
      cancel_url: `${appUrl()}/book/${sessionId}?error=${encodeURIComponent("Payment cancelled. Your seats are held for a few more minutes if you want to try again.")}`,
    });
    await prisma.order.update({ where: { id: order.id }, data: { stripeSessionId: checkout.id } });
    url = checkout.url;
  } catch (e) {
    console.error("Stripe checkout creation failed", e);
    await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
    fail(sessionId, "Payment is unavailable right now. Please try again shortly.");
  }
  if (!url) fail(sessionId, "Payment is unavailable right now. Please try again shortly.");
  redirect(url);
}
