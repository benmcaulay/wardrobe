"use server";

import { requireUser } from "@/lib/auth";
import { getCreditPack } from "@/lib/credit-packs";
import { getStripe, stripeEnabled } from "@/lib/stripe";
import { log } from "@/lib/log";

export type CreateCheckoutResponse =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Create a Stripe Checkout session for a credit pack and return its URL.
 * Inline price_data — no dashboard product setup needed. Fulfillment happens
 * in the webhook (app/api/stripe/webhook), NOT on the success redirect, so
 * credits are granted exactly once even if the user never returns.
 */
export async function createCreditCheckout(packId: string): Promise<CreateCheckoutResponse> {
  const user = await requireUser();
  if (!stripeEnabled()) {
    return { ok: false, error: "Purchases aren't enabled on this deployment." };
  }
  const pack = getCreditPack(packId);
  if (!pack) return { ok: false, error: "Unknown credit pack" };

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (!origin) {
    return { ok: false, error: "Server is missing NEXT_PUBLIC_APP_URL / NEXTAUTH_URL." };
  }

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: pack.currency,
            unit_amount: pack.amountCents,
            product_data: {
              name: `Wardrobe credits — ${pack.label}`,
              description: pack.blurb,
            },
          },
        },
      ],
      // Fulfillment reads these; customer email just prefills Checkout.
      metadata: { userId: user.id, packId: pack.id, credits: String(pack.credits) },
      customer_email: user.email,
      success_url: `${origin}/settings?purchase=success`,
      cancel_url: `${origin}/settings?purchase=cancelled`,
    });
    if (!session.url) return { ok: false, error: "Stripe did not return a checkout URL" };
    return { ok: true, url: session.url };
  } catch (err) {
    log.error("billing.checkout.failed", err, { userId: user.id, packId });
    return { ok: false, error: "Could not start checkout. Please try again." };
  }
}
