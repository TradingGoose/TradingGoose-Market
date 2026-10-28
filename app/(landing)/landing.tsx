import Hero from "./components/hero/market-hero";
import Footer from "./components/footer/landing-footer";
import { LandingNav } from "./components/nav/landing-nav";
import { StructuredData } from "./components/structured-data";
import { isLandingSiteUrlConfigured } from "./site-url";
import { getMarketRuntimeConfig } from "@/lib/environment";

export default function Landing() {
  const registrationOpen = getMarketRuntimeConfig().registrationMode === "open";
  return (
    <>
      {isLandingSiteUrlConfigured() ? <StructuredData /> : null}
      <LandingNav registrationOpen={registrationOpen} />
      <main className="relative min-h-[calc(100svh-3.5rem)] border-border border-b">
        <Hero registrationOpen={registrationOpen} />
      </main>
      <Footer />
    </>
  );
}
