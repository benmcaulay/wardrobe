import { redirect } from "next/navigation";

/**
 * "Today" is now the left column of the Outfits page.
 *
 * Kept as a redirect rather than deleted: the route was in the nav drawer for
 * long enough to be bookmarked, and a 404 is a worse answer than the page the
 * content actually moved to.
 */
export default function TodayPage() {
  redirect("/closet/outfits");
}
