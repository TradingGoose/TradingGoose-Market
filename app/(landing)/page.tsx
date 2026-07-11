import type { Metadata } from "next";

import { landingProduct } from "./components/copy";
import Landing from "./landing";
import { isLandingSiteUrlConfigured } from "./site-url";

const landingTitle = "TradingGoose Market | Canonical Market Reference Data";

export function generateMetadata(): Metadata {
  const configured = isLandingSiteUrlConfigured();

  return {
    title: landingTitle,
    description: landingProduct.description,
    keywords: [
      "TradingGoose Market",
      "market reference data",
      "canonical ticker identity",
      "market data API",
      "trading hours",
      "exchanges",
      "listings",
      "self-hosted market data"
    ],
    authors: [{ name: "TradingGoose" }],
    creator: "TradingGoose",
    publisher: "TradingGoose",
    alternates: configured ? { canonical: "/" } : undefined,
    openGraph: {
      title: landingTitle,
      description: landingProduct.description,
      type: "website",
      siteName: "TradingGoose Market",
      ...(configured ? { url: "/" } : {})
    },
    twitter: {
      card: "summary",
      title: landingTitle,
      description: landingProduct.description
    },
    robots: {
      index: true,
      follow: true
    }
  };
}

export default function LandingPage() {
  return <Landing />;
}
