/**
 * Stripe client singleton. Inert (and the "Buy credits" UI disabled) unless
 * STRIPE_SECRET_KEY is set, so dev/demo/self-host need no Stripe account.
 */
import Stripe from "stripe";

let client: Stripe | null = null;

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) client = new Stripe(key);
  return client;
}
