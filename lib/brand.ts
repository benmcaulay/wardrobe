/**
 * The app's name, in one place.
 *
 * It was previously the literal string "Wardrobe" hardcoded in five unrelated
 * spots — the document title, the landing wordmark canvas, the screen-reader
 * heading, the share-card SVG, and a design-lab page — which is exactly how a
 * rename ends up half-applied.
 *
 * Deliberately *not* applied to code identifiers or data: the `WardrobeItem`
 * model, the `wardrobe` package name, the repo, the local database, and the
 * `WARDROBE_USER_EMAIL` env var all keep their names. Renaming those would mean
 * a migration and a broken script for zero user-visible gain, and "wardrobe"
 * remains a perfectly good word for the domain even when the product is called
 * something else.
 */

/** Product name, as shown to people. */
export const APP_NAME = "MAKING SPACE";

/**
 * Wordmark form. Identical here because the name is already set in caps, but
 * kept separate so the display form can diverge from the prose form without
 * hunting through canvas code.
 */
export const APP_WORDMARK = "MAKING SPACE";

/**
 * One line under the name.
 *
 * Was "Your personal digital closet", which described the old name: it says
 * what the app *is* and nothing about what it's for. The product's argument is
 * that the closet gets smaller and the wearing gets bigger, so the tagline
 * makes that claim instead. Both halves are about the same clothes, which is
 * the point — this is not a decluttering app, it's a wearing app that happens
 * to require decluttering.
 */
export const APP_TAGLINE = "Own less of it, wear more of it.";

/**
 * The two halves of the wordmark, either side of the space.
 *
 * Split here rather than at the render site because the space between them is
 * the one part of this brand that moves (see `wordmarkSpaceEm`), so every
 * surface that draws the name needs the same two strings and the same seam.
 */
export const APP_WORDMARK_PARTS = ((): readonly [string, string] => {
  const at = APP_WORDMARK.indexOf(" ");
  if (at < 0) return [APP_WORDMARK, ""];
  return [APP_WORDMARK.slice(0, at), APP_WORDMARK.slice(at + 1)];
})();
