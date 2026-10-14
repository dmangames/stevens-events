import Link from "next/link";
import { getSettings } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Refund policy" };

export default async function RefundPolicyPage() {
  const s = await getSettings();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <Link href="/" className="text-sm text-slate-500">← Home</Link>
      <h1 className="text-2xl font-bold">Refund and rescheduling policy</h1>
      <p>
        You can reschedule, or ask to cancel, up to {s.refundCutoffHours} hours before your event from the
        &ldquo;My booking&rdquo; link in your confirmation email.{" "}
        {s.feeRefundable ? "The booking fee is refundable." : "The booking fee is not refundable."}
      </p>
      {s.refundPolicyText && <p className="whitespace-pre-line">{s.refundPolicyText}</p>}
      <p>If we cancel an event, you will be refunded in full.</p>
      <p className="text-sm text-slate-500">See also our <Link href="/privacy" className="underline">privacy policy</Link>.</p>
    </main>
  );
}
