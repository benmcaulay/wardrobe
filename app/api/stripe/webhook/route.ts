import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { fulfillCreditPurchase } from "@/lib/billing";
import { log } from "@/lib/log";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe webhook. Signature-verified against the raw body; the only event we
 * fulfill is checkout.session.completed. Returns 200 for events we ignore (so
 * Stripe stops retrying them) and non-2xx only when retrying could help.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !process.env.STRIPE_SECRET_KEY?.trim()) {
    return new NextResponse("Stripe is not configured", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new NextResponse("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    log.error("billing.webhook.bad_signature", err);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") {
    // Async payment methods complete later via checkout.session.async_payment_succeeded;
    // out of scope for card-only packs, but don't grant on unpaid sessions.
    return NextResponse.json({ received: true, ignored: "not_paid" });
  }

  const userId = session.metadata?.userId;
  const packId = session.metadata?.packId;
  const credits = Number(session.metadata?.credits);
  if (!userId || !packId || !Number.isFinite(credits)) {
    log.error("billing.webhook.bad_metadata", null, { sessionId: session.id });
    // Malformed metadata won't improve on retry — acknowledge and alert via logs.
    return NextResponse.json({ received: true, error: "bad_metadata" });
  }

  const result = await fulfillCreditPurchase({
    stripeSessionId: session.id,
    userId,
    packId,
    credits,
    amountCents: session.amount_total ?? 0,
    currency: session.currency ?? "usd",
  });

  if (!result.ok) {
    // Transient (e.g. DB blip): non-2xx so Stripe retries delivery.
    return new NextResponse(result.error, { status: 500 });
  }
  return NextResponse.json({ received: true, granted: result.granted });
}
