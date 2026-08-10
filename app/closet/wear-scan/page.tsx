import { redirect } from "next/navigation";

/**
 * "Find past wears" is now a mode on the camera-roll scan page.
 *
 * Kept as a redirect rather than deleted: it was its own nav entry for long
 * enough to be bookmarked, and a 404 is a worse answer than the page the
 * feature actually moved to.
 */
export default function WearScanPage() {
  redirect("/closet/scan");
}
