import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { fulfilPaidOrder } from "@/lib/orders";
import { sendConfirmationEmail } from "@/lib/email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret.endsWith("...")) return new Response("Webhook secret not configured", { status: 500 });

  // Signature is computed over the raw body, so read it as text before any parsing.
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const cs = event.data.object as Stripe.Checkout.Session;
      if (cs.payment_status !== "paid") break;
      await handlePaid(cs);
      break;
    }
    case "checkout.session.expired": {
      const cs = event.data.object as Stripe.Checkout.Session;
      await prisma.order.updateMany({
        where: { stripeSessionId: cs.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      break;
    }
  }
  return new Response("ok");
}

async function handlePaid(cs: Stripe.Checkout.Session) {
  const orderId = cs.metadata?.orderId;
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null;
  const paymentIntentId = typeof cs.payment_intent === "string" ? cs.payment_intent : cs.payment_intent?.id;

  // Only trust a payment that matches the order we created for exactly this Checkout Session and amount.
  if (!order || order.stripeSessionId !== cs.id || cs.amount_total !== order.totalCents) {
    console.error("Stripe webhook: payment does not match an order", { checkoutSession: cs.id, orderId });
    await prisma.auditLog.create({
      data: { action: "STRIPE_PAYMENT_MISMATCH", entity: "CheckoutSession", entityId: cs.id, meta: { orderId: orderId ?? null } },
    });
    return;
  }

  const result = await fulfilPaidOrder(order.id, { stripePaymentIntentId: paymentIntentId });
  // Also covers "already-paid": a retried webhook re-attempts a send that failed (sends at most once).
  if (result === "paid" || result === "already-paid") await sendConfirmationEmail(order.id);
  if (result === "needs-refund" && paymentIntentId) {
    // The hold lapsed and the seats were sold to someone else: give the money back.
    await stripe().refunds.create({ payment_intent: paymentIntentId }, { idempotencyKey: `auto-refund-${order.id}` });
    await prisma.order.update({ where: { id: order.id }, data: { status: "REFUNDED", stripePaymentIntentId: paymentIntentId } });
    await prisma.auditLog.create({
      data: { action: "ORDER_AUTO_REFUNDED", entity: "Order", entityId: order.id, meta: { reason: "seats no longer available" } },
    });
  }
}
