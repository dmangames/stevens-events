import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/orders";
import { qrPng } from "@/lib/qr";
import { formatMoney, formatSession } from "@/lib/time";

type Attachment = { filename: string; content: string; content_id: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function sendEmail(msg: { to: string; subject: string; html: string; attachments?: Attachment[] }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.endsWith("...")) {
    // No Resend key configured (local dev): show what would have been sent.
    console.log(`[email not sent - RESEND_API_KEY unset] to=${msg.to} subject=${msg.subject}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, attachments: msg.attachments }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return true;
}

/**
 * Emails the tickets (one QR per ticket) and the "My booking" link. Never throws: a mail problem must not
 * fail the payment webhook. `force` re-sends (admin "Resend tickets"); otherwise it sends at most once.
 */
export async function sendConfirmationEmail(orderId: string, opts: { force?: boolean; subject?: string } = {}) {
  try {
    if (!opts.force) {
      const claimed = await prisma.order.updateMany({
        where: { id: orderId, status: "PAID", confirmationSentAt: null },
        data: { confirmationSentAt: new Date() },
      });
      if (claimed.count === 0) return;
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { session: { include: { event: true } }, tickets: { include: { ticketType: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!order || order.status !== "PAID") return;
    const settings = await getSettings();

    const base = process.env.APP_URL ?? "http://localhost:3000";
    const link = `${base}/booking/${order.accessToken}`;
    const live = order.tickets.filter((t) => t.status !== "VOID");
    const attachments: Attachment[] = [];
    for (const [i, t] of live.entries()) {
      attachments.push({ filename: `ticket-${i + 1}.png`, content: (await qrPng(t.qrToken)).toString("base64"), content_id: `qr${i}` });
    }

    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
<h2>You're booked: ${esc(order.session.event.title)}</h2>
<p>${esc(formatSession(order.session.startsAt))}<br>${esc(order.session.event.location)}</p>
<p>Order code <b>${esc(order.code)}</b> &middot; Total ${formatMoney(order.totalCents)}</p>
<p>Show a QR code at the door:</p>
${live
  .map((t, i) => `<div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0;text-align:center"><div>Ticket ${i + 1} of ${live.length} &middot; ${esc(t.ticketType.name)}</div><img src="cid:qr${i}" width="220" height="220" alt="Ticket ${i + 1} QR code"></div>`)
  .join("")}
<p><a href="${link}">View your booking</a></p>
<p style="color:#666;font-size:12px">${esc(settings.businessName)}</p></div>`;

    const sent = await sendEmail({ to: order.customerEmail, subject: opts.subject ?? `Your tickets: ${order.session.event.title}`, html, attachments });
    if (!sent && !opts.force) await prisma.order.update({ where: { id: orderId }, data: { confirmationSentAt: null } });
  } catch (e) {
    console.error("Confirmation email failed", orderId, e);
    if (!opts.force) await prisma.order.updateMany({ where: { id: orderId }, data: { confirmationSentAt: null } }).catch(() => {});
  }
}

/** "We're confirming your payment" email for Venmo/Zelle orders, with the amount, handle and memo code. */
export async function sendPendingPaymentEmail(orderId: string) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { session: { include: { event: true } } } });
    if (!order || order.status !== "PENDING") return;
    const settings = await getSettings();
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const to = order.paymentMethod === "VENMO" ? `Venmo ${settings.venmoHandle}` : `Zelle ${settings.zelleContact}`;
    const deadline = order.holdExpiresAt ? formatSession(order.holdExpiresAt) : "";
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
<h2>Almost there: ${esc(order.session.event.title)}</h2>
<p>${esc(formatSession(order.session.startsAt))}</p>
<p>Your seats are held until <b>${esc(deadline)}</b>. To confirm them, send <b>${formatMoney(order.totalCents)}</b> via <b>${esc(to)}</b> and put <b>${esc(order.code)}</b> in the payment note.</p>
<p>Once we see your payment we'll email your tickets.</p>
<p><a href="${base}/booking/${order.accessToken}">View your booking</a></p>
<p style="color:#666;font-size:12px">${esc(settings.businessName)}</p></div>`;
    await sendEmail({ to: order.customerEmail, subject: `Complete your payment: ${order.session.event.title}`, html });
  } catch (e) {
    console.error("Pending-payment email failed", orderId, e);
  }
}

/** Plain notice to the customer (refund, cancellation). Never throws. */
export async function sendOrderNotice(orderId: string, subject: string, message: string) {
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { session: { include: { event: true } } } });
    if (!order) return;
    const settings = await getSettings();
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
<h2>${esc(order.session.event.title)}</h2>
<p>${esc(message)}</p>
<p>Order code <b>${esc(order.code)}</b></p>
<p><a href="${base}/booking/${order.accessToken}">View your booking</a></p>
<p style="color:#666;font-size:12px">${esc(settings.businessName)}</p></div>`;
    await sendEmail({ to: order.customerEmail, subject, html });
  } catch (e) {
    console.error("Order notice email failed", orderId, e);
  }
}

/** Tells the owner(s) a customer asked to cancel. Never throws. */
export async function sendOwnerNotice(subject: string, message: string) {
  try {
    const owners = await prisma.user.findMany({ where: { role: "OWNER" }, select: { email: true } });
    const base = process.env.APP_URL ?? "http://localhost:3000";
    for (const o of owners) {
      await sendEmail({ to: o.email, subject, html: `<p>${esc(message)}</p><p><a href="${base}/admin/orders">Open orders</a></p>` });
    }
  } catch (e) {
    console.error("Owner notice email failed", e);
  }
}
