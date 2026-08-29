"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CreditMark } from "@/components/credit-mark";
import { ICON_REGISTRY, type IconProps } from "@/components/icons";
import { ThemeChoice } from "@/components/theme-choice";
import { CLOSET_NAV, SETTINGS_HREF, isNavItemActive } from "@/lib/closet-nav";
import { easeOutExpo, springSoft } from "@/lib/ui-motion";

const ICONS_BY_NAME = new Map(ICON_REGISTRY.map((i) => [i.name, i.Component]));

/**
 * Resolve a nav entry's icon name to a component. Falls back to a small dot so
 * a renamed icon degrades to a bullet rather than blowing up the whole drawer.
 */
function NavIcon({ name, className }: { name: string } & Pick<IconProps, "className">) {
  const Component = ICONS_BY_NAME.get(name);
  if (!Component) {
    return <span aria-hidden className={`${className} rounded-full bg-current opacity-30`} />;
  }
  return <Component className={className} />;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Global closet navigation as a right-hand drawer.
 *
 * Lives in app/closet/layout.tsx so every closet route gets the same menu.
 * Closed by default — the grid keeps its full width, and the panel slides in
 * over a dimmed backdrop when summoned.
 */
export function ClosetNavDrawer({ credits }: { credits: number }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Where focus was before we opened, so Escape puts it back.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // Navigating always dismisses the drawer — the panel covers the page you
  // just asked for otherwise.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Escape to close, and keep Tab inside the panel while it's up.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // The panel itself holds focus on open, which counts as "before the
      // first item" — otherwise Shift+Tab would walk out into the page behind.
      const atStart = active === first || active === panel;

      if (e.shiftKey && (atStart || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Freeze the page behind the drawer. Restoring the exact previous value
  // avoids clobbering an overflow another component set.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus into the panel on open, and hand it back on close.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      // Focus the dialog rather than its first control: screen readers
      // announce the panel, and a mouse user doesn't get a focus ring parked
      // on the close button.
      panelRef.current?.focus();
      return;
    }
    const restore = restoreFocusRef.current ?? triggerRef.current;
    restore?.focus?.();
    restoreFocusRef.current = null;
  }, [open]);

  return (
    <>
      <motion.button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="dialog"
        initial={reduce ? false : { opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={springSoft}
        whileHover={reduce ? undefined : { scale: 1.04 }}
        whileTap={reduce ? undefined : { scale: 0.96 }}
        className="fixed right-6 top-6 z-40 flex items-center gap-2 rounded-full border border-ink/10 bg-paper/90 px-4 py-2 text-xs tracking-wide text-ink shadow-tile backdrop-blur transition hover:bg-paper-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <MenuGlyph />
        Menu
      </motion.button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              key="backdrop"
              onClick={close}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.2, ease: easeOutExpo }}
              className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[1px]"
              aria-hidden
            />

            <motion.div
              key="panel"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Closet menu"
              tabIndex={-1}
              initial={reduce ? { opacity: 0 } : { x: "100%" }}
              animate={reduce ? { opacity: 1 } : { x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: "100%" }}
              transition={reduce ? { duration: 0.15 } : springSoft}
              className="fixed right-0 top-0 z-50 flex h-dvh w-[min(20rem,88vw)] flex-col border-l border-ink/10 bg-paper shadow-2xl focus:outline-none"
            >
              <div className="flex items-center justify-between px-6 pb-4 pt-6">
                <h2 className="font-serif text-2xl">Menu</h2>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close menu"
                  className="rounded-full p-1.5 text-xl leading-none text-ink-muted transition hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  ×
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-3 pb-4">
                <ul className="space-y-0.5">
                  {CLOSET_NAV.map((item) => {
                    const active = isNavItemActive(item, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                            active ? "bg-ink text-paper" : "text-ink hover:bg-paper-warm"
                          }`}
                        >
                          <NavIcon
                            name={item.icon}
                            className="mt-0.5 h-[18px] w-[18px] shrink-0"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm">{item.label}</span>
                            <span
                              className={`block text-[11px] ${
                                active ? "text-paper/70" : "text-ink-muted"
                              }`}
                            >
                              {item.hint}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {/* Backdrop sits above Settings rather than inside it: it is a
                  per-device display choice, not a stored preference, and
                  burying a two-tap toggle behind a page load is the reason
                  nobody would ever find Space mode. */}
              <div className="border-t border-ink/10 px-3 pb-3 pt-4">
                <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-ink-muted">
                  Backdrop
                </div>
                <ThemeChoice className="px-1" />
              </div>

              <div className="border-t border-ink/10 px-3 py-4">
                <Link
                  href={SETTINGS_HREF}
                  className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    pathname.startsWith(SETTINGS_HREF)
                      ? "bg-ink text-paper"
                      : "text-ink hover:bg-paper-warm"
                  }`}
                >
                  Settings
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs tabular-nums ${
                      credits < 10
                        ? "bg-amber-100 text-amber-900"
                        : "bg-paper-warm text-ink-muted"
                    }`}
                    title={credits < 10 ? "Running low on credits" : "Ghost-mannequin credits"}
                  >
                    <CreditMark className="h-3.5 w-3.5" title="tokens" />
                    {credits.toLocaleString()}
                  </span>
                </Link>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function MenuGlyph() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden focusable="false">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="1" y1="1" x2="13" y2="1" />
        <line x1="1" y1="5" x2="13" y2="5" />
        <line x1="1" y1="9" x2="13" y2="9" />
      </g>
    </svg>
  );
}
