/**
 * Credit packs sold via Stripe Checkout. Pure module (client-importable for
 * the settings UI). Prices use inline price_data at checkout time, so no
 * Stripe dashboard product setup is required — just API keys.
 *
 * Margin note: 1 credit = 1 generation ≈ $0.03-0.04 provider cost; packs are
 * priced at ~3.5-5¢/credit. Thin but positive — adjust here as costs move.
 */

export type CreditPack = {
  id: string;
  label: string;
  credits: number;
  amountCents: number;
  currency: "usd";
  blurb: string;
};

export const CREDIT_PACKS: CreditPack[] = [
  {
    id: "starter",
    label: "Starter",
    credits: 100,
    amountCents: 500,
    currency: "usd",
    blurb: "100 generations",
  },
  {
    id: "standard",
    label: "Standard",
    credits: 300,
    amountCents: 1200,
    currency: "usd",
    blurb: "300 generations — most popular",
  },
  {
    id: "studio",
    label: "Studio",
    credits: 1000,
    amountCents: 3500,
    currency: "usd",
    blurb: "1,000 generations — best value",
  },
];

const BY_ID = new Map(CREDIT_PACKS.map((p) => [p.id, p]));

export function getCreditPack(id: string): CreditPack | undefined {
  return BY_ID.get(id);
}

export function formatPackPrice(pack: CreditPack): string {
  return `$${(pack.amountCents / 100).toFixed(pack.amountCents % 100 === 0 ? 0 : 2)}`;
}
