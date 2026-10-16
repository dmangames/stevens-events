import Stripe from "stripe";

let client: Stripe | undefined;

export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !(key.startsWith("sk_") || key.startsWith("rk_")) || key.endsWith("...")) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add your Stripe test key to .env.");
  }
  return (client ??= new Stripe(key));
}

export function appUrl() {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
