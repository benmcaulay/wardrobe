"use client";

import { motion, useReducedMotion } from "motion/react";
import { fadeUp, staggerContainer } from "@/lib/ui-motion";

export function SellPageIntro() {
  const reduce = useReducedMotion();
  return (
    <motion.header
      className="mb-8 text-center"
      variants={staggerContainer}
      initial={reduce ? false : "hidden"}
      animate="show"
    >
      {/* "Keep or make space", not "Sell or keep". Same two piles, but the
          right-hand one is named after what it's for rather than after the
          transaction — and the pile is the product name. Keep comes first
          because it is the left swipe and reading order should match the
          gesture. */}
      <motion.h1 variants={fadeUp} className="font-serif text-4xl tracking-tight">
        Keep or make space
      </motion.h1>
      <motion.p variants={fadeUp} className="text-ink-muted mt-2">
        Swipe left to keep a piece, right to make space for something else. We&apos;ll draft the
        listing for anything you let go — you copy it into Depop, Poshmark, and the rest.
      </motion.p>
    </motion.header>
  );
}
