import type { Metadata, Viewport } from "next";

import Background from "./components/background/landing-background";
import { getLandingSiteBaseUrl, isLandingSiteUrlConfigured } from "./site-url";

type LandingLayoutProps = {
  children: React.ReactNode;
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0c" }
  ]
};

export function generateMetadata(): Metadata {
  return {
    ...(isLandingSiteUrlConfigured()
      ? { metadataBase: new URL(getLandingSiteBaseUrl()) }
      : {}),
    other: {
      "msapplication-TileColor": "#000000"
    }
  };
}

export default function LandingLayout({ children }: LandingLayoutProps) {
  return <Background>{children}</Background>;
}
