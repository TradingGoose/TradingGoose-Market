import Hero from "./components/hero/market-hero";
import { LandingNav } from "./components/nav/landing-nav";
import { StructuredData } from "./components/structured-data";
import { isLandingSiteUrlConfigured } from "./site-url";

export default function Landing() {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {isLandingSiteUrlConfigured() ? <StructuredData /> : null}
      <LandingNav />
      <main className="relative min-h-0 flex-1 overflow-hidden">
        <Hero />
      </main>
    </div>
  );
}
