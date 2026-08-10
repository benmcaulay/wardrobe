import { redirect } from "next/navigation";

/**
 * "Closet health" is now a section of the Sell page.
 *
 * Kept as a redirect rather than deleted: it was its own nav entry for long
 * enough to be bookmarked, and a 404 is a worse answer than the page the
 * content actually moved to.
 */
export default function LensesPage() {
  redirect("/closet/sell");
}
