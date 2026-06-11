/**
 * Credit-purchase fulfillment, shared by the Stripe webhook (primary path) and
 * any future reconciliation job. Idempotent: the unique stripeSessionId means a
 * replayed webhook hits the constraint and grants nothing twice.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { log } from "./log";

export type FulfillInput = {
  stripeSessionId: string;
  userId: string;
  packId: string;
  credits: number;
  amountCents: number;
  currency: string;
};

export type FulfillResult =
  | { ok: true; granted: true; creditsAfter: number }
  | { ok: true; granted: false; reason: "already_fulfilled" }
  | { ok: false; error: string };

export async function fulfillCreditPurchase(input: FulfillInput): Promise<FulfillResult> {
  if (!Number.isInteger(input.credits) || input.credits <= 0) {
    return { ok: false, error: `Invalid credits amount: ${input.credits}` };
  }
  try {
    const creditsAfter = await prisma.$transaction(async (tx) => {
      await tx.creditPurchase.create({
        data: {
          userId: input.userId,
          stripeSessionId: input.stripeSessionId,
          packId: input.packId,
          credits: input.credits,
          amountCents: input.amountCents,
          currency: input.currency,
        },
      });
      const updated = await tx.user.update({
        where: { id: input.userId },
        data: { credits: { increment: input.credits } },
        select: { credits: true },
      });
      return updated.credits;
    });
    log.info("billing.credits.granted", {
      userId: input.userId,
      packId: input.packId,
      credits: input.credits,
      sessionId: input.stripeSessionId,
    });
    return { ok: true, granted: true, creditsAfter };
  } catch (err) {
    // Unique violation on stripeSessionId => this event was already fulfilled.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: true, granted: false, reason: "already_fulfilled" };
    }
    log.error("billing.fulfill.failed", err, {
      userId: input.userId,
      sessionId: input.stripeSessionId,
    });
    return { ok: false, error: (err as Error).message };
  }
}
