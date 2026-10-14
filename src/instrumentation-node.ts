import { expireLapsedHolds } from "@/lib/orders";

// Node-only startup work. Kept out of instrumentation.ts so the Edge bundle never sees node:crypto.
// Releases expired seat holds every minute (plan section 7).
export function startBackgroundJobs() {
  const tick = () => expireLapsedHolds().catch((e) => console.error("Hold expiry job failed", e));
  setInterval(tick, 60_000).unref();
  void tick();
}
