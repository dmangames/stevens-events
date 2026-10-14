import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { fulfilPaidOrder } from "@/lib/orders";
import { sendConfirmationEmail } from "@/lib/email";

/**
 * Fallback for a late or missed webhook: ask Stripe directly whether this order's Checkout Session was paid.
 * Same checks as the webhook (session id and amount must match), and fulfilment is idempotent.
 */
export async function reconcileStripeOrder(orderId: string) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "PENDING" || order.paymentMethod !== "STRIPE" || !order.stripeSessionId) return;
    const cs = await stripe().checkout.sessions.retrieve(order.stripeSessionId);
    if (cs.payment_status !== "paid" || cs.amount_total !== order.totalCents) return;
    const pi = typeof cs.payment_intent === "string" ? cs.payment_intent : cs.payment_intent?.id;
    const result = await fulfilPaidOrder(order.id, { stripePaymentIntentId: pi });
    if (result === "paid") await sendConfirmationEmail(order.id);
  } catch (e) {
    console.error("Stripe reconcile failed", orderId, e);
  }
}
