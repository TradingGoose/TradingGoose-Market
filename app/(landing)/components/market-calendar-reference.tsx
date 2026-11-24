import {
  Building2,
  CircleDollarSign,
  Clock3,
  Coins,
  Globe2,
  Layers3,
  MapPin,
  Network,
} from "lucide-react";

import styles from "./market-calendar-reference.module.css";
import { ListingLogo } from "./listing-logo";
import { MarketCalendarPreview } from "./market-calendar-preview";
import { MarketFeatureTextCard } from "./market-feature-text-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function CalendarFeature() {
  return (
    <section
      id="trading-calendars"
      aria-labelledby="calendar-heading"
      className={styles.section}
    >
      <MarketFeatureTextCard
        className={styles.copy}
        headingId="calendar-heading"
        label="Trading calendars"
        icon={<Clock3 className="size-5" />}
        title={<>The full trading day.<br />Including the exceptions.</>}
        description="Get premarket, regular, and postmarket sessions alongside market holidays and early closes."
        bullets={[
          "Request one date or a date range.",
          "Account for exchange time zones and daylight saving changes.",
        ]}
      />

      <MarketCalendarPreview />
    </section>
  );
}

export function ReferenceFeature() {
  return (
    <section
      id="reference-data"
      aria-labelledby="reference-heading"
      className={`${styles.section} ${styles.referenceSection}`}
    >
      <MarketFeatureTextCard
        className={styles.copy}
        headingId="reference-heading"
        label="Reference data"
        icon={<Network className="size-5" />}
        title={<>Connect listings<br />to market context.</>}
        description="Identify the exchange and quote currency, then connect the country, city, and time zone behind the market."
        bullets={[
          "Look up exchanges, currencies, and locations.",
          "Build market filters, selectors, and a directory.",
        ]}
      />

      <Card
        className={`${styles.catalog} rounded-lg bg-background/50 shadow-none backdrop-blur-sm`}
        aria-label="Connected exchange, currency, country, and time zone references"
      >
        <div className="mb-5 flex items-center gap-3">
          <ListingLogo name="apple" />
          <div className="min-w-0 flex-1"><h3 className="text-base font-medium">AAPL</h3><p className="text-xs text-muted-foreground">Apple Inc.</p></div>
          <Badge variant="outline" className="font-normal">Stocks</Badge>
        </div>
        <div className={styles.exchangeTile}>
          <span className={styles.entityLabel}>
            <Building2 aria-hidden="true" />
            Exchanges
          </span>
          <div className={styles.exchangeValue}>
            <strong>XNAS</strong>
            <span>Nasdaq</span>
          </div>
        </div>
        <div className={styles.referenceGrid}>
          <div className={styles.referenceTile}>
            <span className={styles.entityLabel}>
              <CircleDollarSign aria-hidden="true" />
              Currencies
            </span>
            <strong>USD</strong>
            <span>US Dollar</span>
          </div>
          <div className={styles.referenceTile}>
            <span className={styles.entityLabel}>
              <Globe2 aria-hidden="true" />
              Countries
            </span>
            <strong>US</strong>
            <span>United States</span>
          </div>
          <div className={styles.timezoneTile}>
            <span className={styles.entityLabel}>
              <Clock3 aria-hidden="true" />
              Time zones
            </span>
            <strong>America/New_York</strong>
          </div>
        </div>
        <div className={styles.catalogEntities}>
          <span>
            <Layers3 aria-hidden="true" /> Listings
          </span>
          <span>
            <Coins aria-hidden="true" /> Cryptocurrencies
          </span>
          <span>
            <MapPin aria-hidden="true" /> Cities
          </span>
        </div>
      </Card>
    </section>
  );
}
