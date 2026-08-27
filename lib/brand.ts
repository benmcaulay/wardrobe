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

/** One line under the name. */
export const APP_TAGLINE = "Your personal digital closet.";
