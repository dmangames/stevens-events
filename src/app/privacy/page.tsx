import Link from "next/link";
import { getSettings } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy policy" };

// A plain-language starting point. Have it reviewed before launch, and edit anything that doesn't match how you operate.
export default async function PrivacyPage() {
  const s = await getSettings();
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <Link href="/" className="text-sm text-slate-500">← Home</Link>
      <h1 className="text-2xl font-bold">Privacy policy</h1>
      <p>This explains what {s.businessName} collects when you book tickets and how it is used.</p>
      <h2 className="text-lg font-semibold">What we collect</h2>
      <p>
        Your name, email address and phone number, any notes you add, and the details of your booking. We use them to
        confirm your booking, email your tickets, check you in at the door, and contact you about changes to the event.
      </p>
      <h2 className="text-lg font-semibold">Payments</h2>
      <p>
        Card payments are handled by Stripe. Your card details go directly to Stripe and never reach our servers. If
        you pay by Venmo or Zelle, we only see the payment itself in the way that service shows it to us.
      </p>
      <h2 className="text-lg font-semibold">Who we share it with</h2>
      <p>
        Only the services needed to run bookings: Stripe (payments) and our email provider (sending your tickets). We
        do not sell your information or use it for advertising.
      </p>
      <h2 className="text-lg font-semibold">How long we keep it</h2>
      <p>We keep booking records as long as needed for accounting and to handle questions about past events.</p>
      <h2 className="text-lg font-semibold">Your choices</h2>
      <p>To see, correct or delete your information, contact us and quote your order code.</p>
      <p className="text-sm text-slate-500">See also our <Link href="/refund-policy" className="underline">refund policy</Link>.</p>
    </main>
  );
}
