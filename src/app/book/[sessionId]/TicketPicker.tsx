"use client";

import { useState } from "react";
import Script from "next/script";

type Type = { id: string; name: string; priceCents: number; max: number };

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function TicketPicker({
  types,
  feePercent,
  feeAppliesToManual,
  turnstileSiteKey,
  methods,
  seatsLeft,
  sessionId,
  action,
}: {
  types: Type[];
  feePercent: number;
  feeAppliesToManual: boolean;
  turnstileSiteKey?: string;
  methods: string[];
  seatsLeft: number;
  sessionId: string;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const seats = Object.values(qty).reduce((a, b) => a + b, 0);
  const subtotal = types.reduce((sum, t) => sum + t.priceCents * (qty[t.id] ?? 0), 0);
  const [method, setMethod] = useState("STRIPE");
  const feeApplies = method === "STRIPE" || feeAppliesToManual;
  const fee = !feeApplies ? 0 : Math.round((subtotal * Math.round(feePercent * 100)) / 10_000);
  const input = "w-full rounded border px-3 py-2";

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="sessionId" value={sessionId} />
      <ul className="divide-y rounded border">
        {types.map((t) => (
          <li key={t.id} className="flex items-center justify-between px-4 py-3">
            <span>
              {t.name} <span className="text-slate-500">{money(t.priceCents)}</span>
            </span>
            <input
              type="number"
              name={`qty_${t.id}`}
              min={0}
              max={Math.min(t.max, seatsLeft)}
              value={qty[t.id] ?? 0}
              onChange={(e) => setQty({ ...qty, [t.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              aria-label={`${t.name} quantity`}
              className="w-20 rounded border px-2 py-1"
            />
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <input name="name" placeholder="Full name" required autoComplete="name" className={input} />
        <input name="email" type="email" placeholder="Email" required autoComplete="email" className={input} />
        <input name="phone" type="tel" placeholder="Phone" required autoComplete="tel" className={input} />
        <textarea name="notes" placeholder="Notes (optional)" rows={2} className={input} />
      </div>

      {methods.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Pay with</legend>
          {methods.map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input type="radio" name="method" value={m} checked={method === m} onChange={() => setMethod(m)} />
              {m === "STRIPE" ? "Card / Apple Pay / Google Pay" : m === "VENMO" ? "Venmo" : "Zelle"}
            </label>
          ))}
        </fieldset>
      )}

      <div className="rounded bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span>Tickets ({seats})</span><span>{money(subtotal)}</span></div>
        {fee > 0 && <div className="flex justify-between"><span>Booking fee ({feePercent}%)</span><span>{money(fee)}</span></div>}
        <div className="mt-1 flex justify-between font-semibold"><span>Total</span><span>{money(subtotal + fee)}</span></div>
      </div>

      {turnstileSiteKey && (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
        </>
      )}

      <button
        disabled={seats === 0 || seats > seatsLeft}
        className="w-full rounded bg-slate-900 px-4 py-3 text-white disabled:opacity-40"
      >
        {subtotal + fee === 0 ? "Reserve" : method === "STRIPE" ? "Continue to payment" : "Reserve my seats"}
      </button>
    </form>
  );
}
