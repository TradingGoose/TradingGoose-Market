import {
  ClockIcon,
  GitBranchIcon,
  LandmarkIcon,
  ListIcon
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WordRotate } from "@/components/ui/word-rotate";

import { landingGitHubLink, landingHero } from "../copy";
import { MarketGlobe } from "./market-globe";

const featureBadgeIcons = [ListIcon, LandmarkIcon, ClockIcon, GitBranchIcon];

export default function Hero() {
  return (
    <section className="relative h-full overflow-hidden">
      <div className="flex-1 pt-8 sm:pt-16 lg:pt-24">
        <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center gap-8 px-4 sm:gap-16 sm:px-6 lg:gap-24 lg:px-8">
          <div className="flex shrink-0 flex-col items-center gap-4 text-center">
            <Badge
              variant="outline"
              className="relative z-10 rounded-full bg-background font-normal text-sm"
            >
              {landingHero.statusBadge}
            </Badge>

            <h1 className="relative z-10 text-2xl font-semibold sm:text-3xl lg:text-5xl lg:font-bold">
              {landingHero.headlineLead}{" "}
              <WordRotate
                words={landingHero.headlineRotatingPhrases}
                duration={4000}
                className="underline decoration-[0.08em] underline-offset-4"
              />{" "}
              {landingHero.headlineSuffix}
            </h1>

            <p className="relative z-10 max-w-3xl text-lg text-muted-foreground leading-relaxed">
              {landingHero.description}
            </p>

            <div className="relative z-10 flex flex-wrap items-center justify-center gap-2">
              {landingHero.featureBadges.map((badge, index) => {
                const Icon = featureBadgeIcons[index];

                return (
                  <Badge
                    key={badge}
                    variant="secondary"
                    className="gap-1.5 rounded-full px-3 py-1 font-normal text-xs"
                  >
                    {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
                    {badge}
                  </Badge>
                );
              })}
            </div>

            <div className="relative z-10 mt-4 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" className="font-semibold text-lg" asChild>
                <a
                  href={landingGitHubLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Source on GitHub
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-[20rem] z-0 h-[42rem] overflow-visible sm:top-[24rem] sm:h-[56rem] lg:top-[30rem] lg:h-[64rem]"
      >
        <div className="relative h-full w-full">
          <MarketGlobe />
        </div>
      </div>
    </section>
  );
}
