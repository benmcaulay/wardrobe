"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { springSnappy } from "@/lib/ui-motion";

/** Floating + FAB with light Motion polish — strip by reverting closet/page.tsx. */
export function AddItemFab() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className="fixed bottom-8 right-8 z-40"
      initial={reduce ? false : { opacity: 0, scale: 0.8, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={springSnappy}
    >
      <motion.div whileHover={reduce ? undefined : { scale: 1.06 }} whileTap={reduce ? undefined : { scale: 0.94 }}>
        <Link
          href="/closet/add"
          aria-label="Add item"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-2xl text-paper shadow-tile transition hover:bg-ink-soft"
        >
          +
        </Link>
      </motion.div>
    </motion.div>
  );
}
