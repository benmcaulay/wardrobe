/**
 * Integration check for credit-purchase fulfillment. Run with: pnpm test:stripe
 *
 * Always (needs DATABASE_URL):
 *  - fulfillCreditPurchase grants credits exactly once; webhook replays are
 *    no-ops (unique stripeSessionId); junk credit amounts are rejected.
 *
 * Additionally, when STRIPE_WEBHOOK_URL is set (server running with
 * STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET test values):
 *  - POSTs a checkout.session.completed event signed with the real Stripe
 *    signing scheme (stripe.webhooks.generateTestHeaderString) and asserts the
 *    route verifies, grants once, ignores the replay, and 400s a bad signature.
 */
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";
import { fulfillCreditPurchase } from "../lib/billing";

const prisma = new PrismaClient();
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`  ok: ${msg}`);
};

async function main() {
  const user = await prisma.user.create({
    data: { email: `stripe-${Date.now()}@test.local`, credits: 10 },
  });

  // --- direct fulfillment ---------------------------------------------------
  const sessionId = `cs_test_${Date.now()}`;
  const first = await fulfillCreditPurchase({
    stripeSessionId: sessionId,
    userId: user.id,
    packId: "starter",
    credits: 100,
    amountCents: 500,
    currency: "usd",
  });
  assert(first.ok && first.granted, "first fulfillment grants");
  let u = await prisma.user.findUnique({ where: { id: user.id } });
  assert(u?.credits === 110, "credits incremented (10 + 100)");

  const replay = await fulfillCreditPurchase({
    stripeSessionId: sessionId,
    userId: user.id,
    packId: "starter",
    credits: 100,
    amountCents: 500,
    currency: "usd",
  });
  assert(replay.ok && !replay.granted, "replayed session id grants nothing");
  u = await prisma.user.findUnique({ where: { id: user.id } });
  assert(u?.credits === 110, "credits unchanged after replay");

  const junk = await fulfillCreditPurchase({
    stripeSessionId: `cs_junk_${Date.now()}`,
    userId: user.id,
    packId: "starter",
    credits: -5,
    amountCents: 500,
    currency: "usd",
  });
  assert(!junk.ok, "negative credits rejected");

  // --- end-to-end webhook (optional) ---------------------------------------
  const url = process.env.STRIPE_WEBHOOK_URL?.trim();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (url && secret) {
    const stripe = new Stripe("sk_test_dummy");
    const makeEvent = (sid: string) =>
      JSON.stringify({
        id: `evt_${sid}`,
        object: "event",
        type: "checkout.session.completed",
        data: {
          object: {
            id: sid,
            object: "checkout.session",
            payment_status: "paid",
            amount_total: 1200,
            currency: "usd",
            metadata: { userId: user.id, packId: "standard", credits: "300" },
          },
        },
      });

    const sid = `cs_wh_${Date.now()}`;
    const payload = makeEvent(sid);
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

    const post = (body: string, sig: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": sig },
        body,
      });

    const res1 = await post(payload, header);
    const body1 = (await res1.json()) as { granted?: boolean };
    assert(res1.ok && body1.granted === true, "webhook verifies signature and grants");
    u = await prisma.user.findUnique({ where: { id: user.id } });
    assert(u?.credits === 410, "credits incremented via webhook (110 + 300)");

    const res2 = await post(payload, header);
    const body2 = (await res2.json()) as { granted?: boolean };
    assert(res2.ok && body2.granted === false, "webhook replay grants nothing");
    u = await prisma.user.findUnique({ where: { id: user.id } });
    assert(u?.credits === 410, "credits unchanged after webhook replay");

    const resBad = await post(payload, "t=1,v1=deadbeef");
    assert(resBad.status === 400, "bad signature -> 400");

    const resUnsigned = await fetch(url, { method: "POST", body: payload });
    assert(resUnsigned.status === 400, "missing signature -> 400");
  } else {
    console.log("  (skipped end-to-end webhook checks — set STRIPE_WEBHOOK_URL + STRIPE_WEBHOOK_SECRET)");
  }

  await prisma.user.delete({ where: { id: user.id } });
  console.log("\nAll Stripe fulfillment checks passed.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
