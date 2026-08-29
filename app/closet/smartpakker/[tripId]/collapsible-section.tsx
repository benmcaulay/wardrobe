"use client";

/**
 * A trip-page card you can fold away.
 *
 * The page is seven stacked cards and you usually care about one, so each is a
 * disclosure that remembers whether it's open. State lives in localStorage,
 * keyed by section rather than by trip — see lib/packing/panel-state.ts.
 *
 * `PanelStateProvider` holds the whole set so a dozen sections share one read
 * and one write instead of each hitting storage on every toggle.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  PANEL_STORAGE_KEY,
  isPanelOpen,
  parsePanelState,
  serializePanelState,
  togglePanel,
  type PanelState,
} from "@/lib/packing/panel-state";
import { easeOutExpo } from "@/lib/ui-motion";

type PanelContextValue = {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
  /** False until the stored state has been read, so SSR and hydration agree. */
  hydrated: boolean;
};

const PanelContext = createContext<PanelContextValue | null>(null);

export function PanelStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PanelState>(() => parsePanelState(null));
  const [hydrated, setHydrated] = useState(false);

  /**
   * Read after mount, never during render. The server has no localStorage, so
   * seeding from it directly would render a collapsed card on the client and an
   * open one on the server — a hydration mismatch. Everything starts at the
   * defaults and settles a frame later.
   */
  useEffect(() => {
    try {
      setState(parsePanelState(window.localStorage.getItem(PANEL_STORAGE_KEY)));
    } catch {
      /* private mode, quota, disabled storage — the defaults are fine */
    }
    setHydrated(true);
  }, []);

  const toggle = useCallback((id: string) => {
    setState((prev) => {
      const next = togglePanel(prev, id);
      try {
        window.localStorage.setItem(PANEL_STORAGE_KEY, serializePanelState(next));
      } catch {
        /* a preference that can't be saved is still worth applying */
      }
      return next;
    });
  }, []);

  const value = useMemo<PanelContextValue>(
    () => ({ isOpen: (id) => isPanelOpen(state, id), toggle, hydrated }),
    [state, toggle, hydrated],
  );

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanels(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error("CollapsibleSection must be used inside PanelStateProvider");
  return ctx;
}

export function CollapsibleSection({
  id,
  title,
  /** Sits on the header row, right of the title. Shown even when collapsed. */
  summary,
  /** Controls that belong to the section, hidden with it. */
  actions,
  children,
  className,
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { isOpen, toggle, hydrated } = usePanels();
  const reduceMotion = useReducedMotion();
  const open = isOpen(id);
  const bodyId = `panel-${id}`;

  return (
    <section
      className={`rounded-2xl border border-ink/10 bg-surface shadow-tile ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="group flex min-w-0 items-center gap-2 text-left"
        >
          <Chevron open={open} />
          <span className="font-serif text-xl">{title}</span>
          {summary ? <span className="truncate text-xs text-ink-muted">{summary}</span> : null}
        </button>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>

      {/*
        Animating height needs a measured target, which `height: auto` isn't.
        Motion resolves "auto" for us, but only once the content has laid out —
        so the very first render (before `hydrated`) skips the animation
        entirely rather than playing an open-from-zero on page load.
      */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            id={bodyId}
            initial={hydrated && !reduceMotion ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? { height: 0, opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: easeOutExpo }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

/** Rotates to point down when open. Matches the icon suite's stroke language. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 text-ink-muted transition-transform duration-200 group-hover:text-ink ${
        open ? "rotate-90" : ""
      }`}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}
