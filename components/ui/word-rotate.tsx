"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/ui/utils";

type WordRotateProps = {
  words: readonly string[];
  duration?: number;
  className?: string;
};

export function WordRotate({
  words,
  duration = 4000,
  className
}: WordRotateProps) {
  const prefersReducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion || words.length <= 1) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setIndex((currentIndex) => (currentIndex + 1) % words.length);
    }, duration);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [duration, prefersReducedMotion, words.length]);

  const activeWord = words[index] ?? "";

  return (
    <span className="inline-flex overflow-hidden align-baseline">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={activeWord}
          initial={prefersReducedMotion ? false : { y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={prefersReducedMotion ? undefined : { y: "-100%", opacity: 0 }}
          transition={
            prefersReducedMotion
              ? { duration: 0 }
              : { duration: 0.35, ease: "easeInOut" }
          }
          className={cn("inline-block", className)}
        >
          {activeWord}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
