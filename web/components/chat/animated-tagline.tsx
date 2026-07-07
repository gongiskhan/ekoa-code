"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "@/stores/i18n";

/**
 * The empty-state tagline ("O que vamos construir?") with the verb cycling
 * through a small list every few seconds. Locale-aware via i18n store.
 */
export function AnimatedTagline({ className }: { className?: string }) {
  const { emptyState } = useTranslation();
  const { taglinePrefix, taglineVerbs } = emptyState;

  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (taglineVerbs.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % taglineVerbs.length);
    }, 2600);
    return () => clearInterval(id);
  }, [taglineVerbs.length]);

  const verb = taglineVerbs[index] ?? "";

  return (
    <h1 className={className}>
      <span>{taglinePrefix}</span>
      <span className="relative inline-block align-baseline">
        {/* Invisible widest-verb spacer reserves a constant width so the line never
            reflows: the verb's left edge stays pinned right after the prefix and the
            word only grows/shrinks to the right as it cycles. */}
        <span aria-hidden className="invisible whitespace-nowrap">
          {taglineVerbs.reduce((longest, v) => (v.length > longest.length ? v : longest), "")}
        </span>
        <AnimatePresence mode="wait">
          <motion.span
            key={verb}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="absolute inset-0 text-teal-600 text-left whitespace-nowrap"
          >
            {verb}
          </motion.span>
        </AnimatePresence>
      </span>
    </h1>
  );
}
