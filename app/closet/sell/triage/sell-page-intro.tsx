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
      <motion.h1 variants={fadeUp} className="font-serif text-4xl tracking-tight">
        Sell or keep
      </motion.h1>
      <motion.p variants={fadeUp} className="text-ink-muted mt-2">
        Swipe right to list a piece for sale, left to keep it. We&apos;ll draft the listing for you
        — you copy it into Depop, Poshmark, and the rest.
      </motion.p>
    </motion.header>
  );
}
