"use client";

const SRC = "/icons/tokens.png";

type Props = {
  /** Tailwind / arbitrary sizes, e.g. h-3.5 w-3.5 */
  className?: string;
  title?: string;
};

/** Credits badge / inline icon (replaces ✨ in product UI). */
export function CreditMark({
  className = "h-[1em] w-[1em] inline-block align-[-0.15em] object-contain shrink-0",
  title,
}: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static mark, no layout shift worth optimizing
    <img
      src={SRC}
      alt={title ?? ""}
      title={title}
      className={className}
      {...(!title ? { "aria-hidden": true } : {})}
    />
  );
}
