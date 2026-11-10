import Hero from "./components/hero/market-hero";
import Footer from "./components/footer/landing-footer";
import { LandingNav } from "./components/nav/landing-nav";
import { StructuredData } from "./components/structured-data";
import { isLandingSiteUrlConfigured } from "./site-url";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { MarketContent } from "./components/market-content";

export default function Landing() {
  const registrationOpen = getMarketRuntimeConfig().registrationMode === "open";
  return (
    <>
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[60] -translate-y-24 rounded-md border bg-background px-4 py-3 text-sm font-medium focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-foreground"
      >
        Skip to content
      </a>
      {isLandingSiteUrlConfigured() ? <StructuredData /> : null}
      <LandingNav registrationOpen={registrationOpen} />
      <main
        id="main-content"
        tabIndex={-1}
        className="relative min-h-[calc(100svh-3.5rem)] border-border border-b pb-48"
      >
        <Hero registrationOpen={registrationOpen} />
        <MarketContent />
      </main>
      <Footer />
    </>
  );
}
