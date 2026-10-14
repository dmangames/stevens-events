import { requireRole } from "@/lib/authz";
import { getSettings } from "@/lib/orders";
import { prisma } from "@/lib/db";
import { saveSettings } from "./actions";
import { addStaff, removeStaff } from "./staff-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; staffError?: string }> }) {
  await requireRole("OWNER");
  const s = await getSettings();
  const { saved, staffError } = await searchParams;
  const staff = await prisma.user.findMany({
    where: { role: "STAFF", NOT: { email: { endsWith: "@invalid.local" } } },
    orderBy: { name: "asc" },
  });
  const input = "w-full rounded border px-3 py-2";
  const label = "block space-y-1 text-sm font-medium";

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      {saved && <p className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-800">Saved</p>}
      <form action={saveSettings} className="mt-6 space-y-4">
        <label className={label}>Business name<input name="businessName" defaultValue={s.businessName} required className={input} /></label>
        <label className={label}>Booking fee (%)<input name="bookingFeePercent" type="number" step="0.01" min="0" max="30" defaultValue={String(s.bookingFeePercent)} className={input} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="feeAppliesToManual" defaultChecked={s.feeAppliesToManual} /> Also charge the booking fee on Venmo / Zelle orders</label>
        <label className={label}>Venmo handle (leave blank to hide Venmo)<input name="venmoHandle" defaultValue={s.venmoHandle} placeholder="@your-handle" className={input} /></label>
        <label className={label}>Zelle email or phone (leave blank to hide Zelle)<input name="zelleContact" defaultValue={s.zelleContact} className={input} /></label>
        <label className={label}>Venmo / Zelle seat hold (minutes)<input name="holdMinutesManual" type="number" min="15" defaultValue={s.holdMinutesManual} className={input} /></label>
        <label className={label}>Refunds / rescheduling allowed until (hours before the event)<input name="refundCutoffHours" type="number" min="0" defaultValue={s.refundCutoffHours} className={input} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="feeRefundable" defaultChecked={s.feeRefundable} /> Booking fee is refundable</label>
        <label className={label}>Refund policy text<textarea name="refundPolicyText" rows={4} defaultValue={s.refundPolicyText} className={input} /></label>
        <button className="rounded bg-slate-900 px-4 py-2 text-white">Save</button>
      </form>

      <h2 className="mt-12 text-xl font-bold">Door staff</h2>
      <p className="text-sm text-slate-500">Staff can view guest lists and scan tickets. They cannot see revenue, refund, or edit events.</p>
      {staffError && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{staffError}</p>}
      <ul className="mt-4 divide-y rounded border">
        {staff.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span>{u.name} · {u.email}</span>
            <form action={removeStaff}>
              <input type="hidden" name="id" value={u.id} />
              <button className="text-red-700 underline">Remove</button>
            </form>
          </li>
        ))}
        {!staff.length && <li className="px-4 py-3 text-sm text-slate-500">No staff accounts yet.</li>}
      </ul>
      <form action={addStaff} className="mt-4 space-y-3">
        <input name="name" placeholder="Name" required className={input} />
        <input name="email" type="email" placeholder="Email" required className={input} />
        <input name="password" type="password" placeholder="Password (10+ characters)" minLength={10} required autoComplete="new-password" className={input} />
        <button className="rounded border px-4 py-2">Add staff</button>
      </form>
    </main>
  );
}
