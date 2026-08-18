/**
 * Button tokens that server components need to read.
 *
 * These live outside components/ui-button.tsx because that file is
 * `"use client"`, and Next turns every export of a client module into a client
 * reference — importing even a plain object from a server component fails with
 * "Could not find the module … in the React Client Manifest".
 */

export type ButtonVariant = "solid" | "outline" | "quiet" | "accent" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

/** Glyph pixel size per button size, so icons stay optically level with the text. */
export const BUTTON_ICON_SIZE: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 17 };
