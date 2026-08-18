"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Buttons drawn to the icon suite's rules.
 *
 * components/icons.tsx is monoline: a uniform 1.75 stroke at 24px, round caps
 * and joins, soft generous geometry, everything painted in `currentColor` with
 * no background plate. These buttons follow the same three rules so an icon
 * dropped into one looks native rather than pasted on:
 *
 *   1. Hairline, not heavy — outlined variants use a 1.5px border, the closest
 *      match to a 1.75 stroke once the icon is scaled down to 14-18px.
 *   2. Round everything — full pill radius echoes the round caps; no square
 *      corners anywhere in the set.
 *   3. One colour per button — border, label and icon all inherit
 *      `currentColor`, so an icon needs no colour prop and can never drift out
 *      of step with its label.
 *
 * Sizes carry their own icon size, so `<Button size="sm" icon={<Camera/>}>`
 * scales the glyph with the text instead of leaving a 20px default icon in a
 * 12px button.
 */

import { type ButtonSize, type ButtonVariant } from "@/lib/ui-button-tokens";

export type { ButtonSize, ButtonVariant };

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full " +
  "font-normal tracking-wide transition-[background-color,border-color,color,transform] " +
  "duration-150 ease-out active:scale-[0.97] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-paper disabled:opacity-45 disabled:pointer-events-none";

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-[11px]",
  md: "h-9 px-4 text-xs",
  lg: "h-11 px-6 text-sm",
};

/** Icon-only buttons are circles, so height doubles as width. */
const ICON_ONLY_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 w-7 p-0",
  md: "h-9 w-9 p-0",
  lg: "h-11 w-11 p-0",
};

const VARIANTS: Record<ButtonVariant, string> = {
  // The one filled button on a view. Border matches the fill so its silhouette
  // is identical to the outlined variants — they line up in a row.
  solid: "border-[1.5px] border-ink bg-ink text-paper hover:bg-ink-soft hover:border-ink-soft",
  // The default. Hairline echoing the monoline stroke.
  outline: "border-[1.5px] border-ink/20 bg-transparent text-ink hover:border-ink/45 hover:bg-paper-warm",
  // Tertiary: no border at all, so a row of them reads as text with glyphs.
  quiet: "border-[1.5px] border-transparent bg-transparent text-ink-muted hover:text-ink hover:bg-paper-warm",
  // Sage, for affirmative or in-progress actions.
  accent: "border-[1.5px] border-accent bg-accent text-paper hover:bg-accent/90 hover:border-accent/90",
  // Destructive stays outlined — a filled red button is louder than this app is.
  danger: "border-[1.5px] border-red-800/25 bg-transparent text-red-800 hover:bg-red-50 hover:border-red-800/45",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading glyph. Size it via BUTTON_ICON_SIZE, or let the caller decide. */
  icon?: ReactNode;
  /** Trailing glyph — chevrons, external-link marks. */
  iconAfter?: ReactNode;
  /** Circular, glyph only. `aria-label` becomes required in practice. */
  iconOnly?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", icon, iconAfter, iconOnly = false, className = "", children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${BASE} ${iconOnly ? ICON_ONLY_SIZES[size] : SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {!iconOnly && children}
      {!iconOnly && iconAfter}
    </button>
  );
});

/**
 * Joined single-choice row — the self-timer control, a sort switch.
 *
 * One hairline around the whole group rather than one per option, so the set
 * reads as a single object; the active option is the only filled thing inside.
 */
export function SegmentedGroup({
  children,
  className = "",
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded-full border-[1.5px] border-ink/20 bg-transparent p-1 ${className}`}
    >
      {children}
    </div>
  );
}

export function SegmentedOption({
  active,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] tracking-wide transition-colors duration-150 ${
        active ? "bg-ink text-paper" : "text-ink-muted hover:text-ink hover:bg-paper-warm"
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
