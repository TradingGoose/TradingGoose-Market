import { Braces, Layers3 } from "lucide-react";

import { soehne } from "@/app/fonts/soehne/soehne";
import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";
import { Button } from "@/components/ui/button";

import { landingExternalLinks } from "./copy";
import { MarketAccessFeature } from "./market-access-feature";
import { MarketApiPreview } from "./market-api-preview";
import { CalendarFeature, ReferenceFeature } from "./market-calendar-reference";
import { MarketDayPreview } from "./market-day-preview";
import { MarketFeatureTextCard } from "./market-feature-text-card";
import { MarketListingPreview } from "./market-listing-preview";
import { DiscordMark } from "./social-icons";
import styles from "./market-content.module.css";

export function MarketContent() {
  return (
    <div className={`${soehne.className} ${styles.content}`}>
      <div className={styles.container}>
        <section
          id="market-hours"
          aria-labelledby="hours-heading"
          className={styles.hoursSection}
        >
          <header className={styles.introduction}>
            <h2 id="hours-heading">Market hours, with the listing attached.</h2>
            <p>
              Find the right listing, identify its exchange and currency, and
              look up when it trades.
            </p>
          </header>
          <MarketDayPreview />
          <ul
            className={styles.capabilities}
            aria-label="Reference data capabilities"
          >
            <li>Sessions &amp; holidays</li>
            <li>Time zones &amp; daylight saving</li>
            <li>Listing IDs by exchange</li>
          </ul>
        </section>
      </div>

      <div className="relative isolate overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[-1] overflow-hidden"
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent, black 40%, black 60%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 40%, black 60%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
            maskComposite: "intersect",
            WebkitMaskComposite: "destination-in",
          }}
        >
          <BackgroundRippleEffect cellSize={90} rows={80} cols={27} maskClassName="" interactive={false} />
        </div>
        <div className={styles.container}>
          <section
            id="listing-identities"
            aria-labelledby="identity-heading"
            className={styles.identitySection}
          >
            <MarketFeatureTextCard
              className={styles.sectionCopy}
              headingId="identity-heading"
              label="Listings"
              icon={<Layers3 className="size-5" />}
              title={<>Find the listing.<br />Keep its identity.</>}
              description="A ticker alone doesn’t identify a listing. Keep its exchange, trading currency, and market time zone together."
              bullets={[
                "Search by symbol or name.",
                "Narrow by currency, asset class, country, or market.",
                "Retrieve one listing or a batch of up to 200 IDs.",
              ]}
            />
            <MarketListingPreview />
          </section>

          <CalendarFeature />
          <ReferenceFeature />

          <section
            id="developers"
            aria-labelledby="developers-heading"
            className={styles.developerSection}
          >
            <MarketFeatureTextCard
              className={styles.sectionCopy}
              headingId="developers-heading"
              label="JSON API"
              icon={<Braces className="size-5" />}
              title={<>From a search<br />to a trading schedule.</>}
              description="Search for a listing, keep its ID, and request the market schedule through one versioned JSON API."
              bullets={[
                "Single-record and batch listing lookups.",
                "Trading hours for a date or date range.",
                "Exchange, currency, and time-zone lookups.",
              ]}
            />
            <MarketApiPreview />
          </section>

          <MarketAccessFeature />
        </div>
      </div>

      <section
        id="get-started"
        aria-labelledby="start-heading"
        className="px-4 py-16 font-sans md:py-24"
      >
        <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border bg-card py-8 shadow-sm md:py-10 dark:bg-card/50">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
            style={{
              maskImage:
                "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent), linear-gradient(to right, transparent, black 20%, black 80%, transparent)",
              maskComposite: "intersect",
              WebkitMaskComposite: "destination-in",
            }}
          >
            <BackgroundRippleEffect cellSize={60} rows={12} cols={20} maskClassName="" interactive />
          </div>
          <div className="relative z-10 flex flex-col gap-y-6 px-4">
            <div className="space-y-2">
              <h2 id="start-heading" className="text-center text-lg font-semibold tracking-tight md:text-2xl">
                Bring market context to your product.
              </h2>
              <p className="text-balance text-center text-sm text-muted-foreground md:text-base">
                Connect with the TradingGoose community.
              </p>
            </div>
            <div className="flex items-center justify-center">
              <Button variant="outline" className="bg-background" asChild>
                <a href={landingExternalLinks.discord} target="_blank" rel="noopener noreferrer">
                  <DiscordMark aria-hidden="true" className="size-4" />
                  Join Discord
                  <span className="sr-only"> (opens in new tab)</span>
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
