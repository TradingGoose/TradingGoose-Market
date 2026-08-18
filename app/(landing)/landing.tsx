import Hero from "./components/hero/market-hero";
import Footer from "./components/footer/landing-footer";
import { LandingNav } from "./components/nav/landing-nav";
import { StructuredData } from "./components/structured-data";
import { isLandingSiteUrlConfigured } from "./site-url";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {isLandingSiteUrlConfigured() ? <StructuredData /> : null}
      <LandingNav />
      <main className="relative min-h-[calc(100svh-3.5rem)] border-border border-b">
        <Hero />
      </main>
      <Footer />
    </div>
  );
}
