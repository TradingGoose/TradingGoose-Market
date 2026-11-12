"use client";

import type { PointerEvent, ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/ui/utils";

type FeatureTextCardProps = {
  headingId: string;
  label: string;
  icon: ReactNode;
  title: ReactNode;
  description: string;
  bullets: readonly string[];
  className?: string;
};

function moveGlow(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== "mouse") return;
  const card = event.currentTarget;
  const bounds = card.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  card.style.setProperty("--shine-x", `${x / bounds.width * 100}%`);
  card.style.setProperty("--shine-y", `${y / bounds.height * 100}%`);
  const glow = card.querySelector<HTMLElement>("[data-feature-glow]");
  if (glow) {
    glow.style.opacity = "1";
    glow.style.transform = `translate(${x - 104}px, ${y - 104}px)`;
  }
}

export function MarketFeatureTextCard({ headingId, label, icon, title, description, bullets, className }: FeatureTextCardProps) {
  return (
    <div
      data-feature-text-card=""
      className={cn("group/feature relative isolate m-1 overflow-hidden rounded-lg p-px font-sans transition-all duration-300 ease-in-out motion-reduce:transition-none", className)}
      onPointerMove={moveGlow}
      onPointerLeave={(event) => {
        const glow = event.currentTarget.querySelector<HTMLElement>("[data-feature-glow]");
        if (glow) glow.style.opacity = "0";
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 rounded-lg bg-foreground/10 p-px"
        style={{
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
        }}
      >
        <div
          data-feature-glow=""
          className="absolute left-0 top-0 size-[120px] rounded-full opacity-0 blur-xl transition-all duration-300 ease-in-out motion-reduce:transition-none"
          style={{ backgroundColor: "hsl(var(--primary) / 0.7)" }}
        />
      </div>
      <Card data-feature-text-surface="" className="relative flex h-full min-h-0 flex-col justify-between gap-8 overflow-hidden rounded-lg border bg-card p-6 shadow-none transition-all duration-300 ease-in-out motion-reduce:transition-none">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-300 group-hover/feature:opacity-100 motion-reduce:transition-none"
          style={{ background: "radial-gradient(circle at var(--shine-x, 50%) var(--shine-y, 50%), hsl(var(--primary) / 0.06), transparent 40%)" }}
        />
        <div className="relative z-10 space-y-4">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-foreground shadow-sm">
              {icon}
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
          </div>
          <h2 id={headingId} className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">{title}</h2>
          <p className="max-w-xl text-base leading-7 text-muted-foreground">{description}</p>
        </div>
        <ul className="relative z-10 space-y-3.5">
          {bullets.map((bullet) => (
            <li key={bullet} className="block">
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="h-px w-4 shrink-0 bg-primary" />
                <p className="text-sm leading-relaxed text-muted-foreground">{bullet}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
