import Image from "next/image";
import Link from "next/link";

import { soehne } from "@/app/fonts/soehne/soehne";

import {
  landingExternalLinks,
  landingProduct
} from "../copy";
import { DiscordMark, GitHubMark } from "../social-icons";
import FooterHoverText from "./footer-hover-text";

const footerLinks = [
  { label: "Hours", href: "/#market-hours", external: false },
  { label: "Listings", href: "/#listing-identities", external: false },
  { label: "Developers", href: "/#developers", external: false },
  { label: "GitHub", href: landingExternalLinks.marketGitHub, external: true },
  { label: "Community", href: landingExternalLinks.discord, external: true },
  { label: "Studio", href: landingExternalLinks.studioSite, external: true }
] as const;

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className={`${soehne.className} relative`}>
      <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-6 pb-6 sm:px-6 sm:pt-8 lg:px-8">
        <div className="relative z-10 flex flex-col gap-8 text-muted-foreground sm:gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-[30rem] flex-col gap-5 max-sm:items-center max-sm:text-center">
            <Link
              href="/"
              aria-label="TradingGoose Market home"
              className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              prefetch={false}
            >
              <Image
                src="/icon.svg"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7"
                priority
                quality={100}
              />
              <span className="font-semibold text-foreground text-xl">
                {landingProduct.brand}
              </span>
            </Link>

            <p className="max-w-[28rem] text-balance text-sm leading-relaxed">
              {landingProduct.footerDescription}
            </p>

            <div className="flex items-center gap-4 max-sm:justify-center">
              <a
                href={landingExternalLinks.discord}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Discord (opens in new tab)"
                className="rounded-md transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <DiscordMark className="h-5 w-5" aria-hidden="true" />
              </a>
              <a
                href={landingExternalLinks.marketGitHub}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub (opens in new tab)"
                className="rounded-md transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <GitHubMark className="h-5 w-5" aria-hidden="true" />
              </a>
            </div>

            <p className="max-w-[28rem] text-balance font-light text-xs leading-relaxed">
              Copyright {year} TradingGoose. All rights reserved.
            </p>
          </div>

          <div className="order-first space-y-16 text-sm max-sm:text-center sm:max-w-[28rem] sm:self-start lg:order-none lg:items-end">
            <div className="grid grid-cols-3 gap-x-8 gap-y-3 sm:grid-cols-4 sm:gap-x-12">
              {footerLinks.map((link) => (
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {link.label}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    prefetch={false}
                    className="rounded-md transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {link.label}
                  </Link>
                )
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 py-3 text-xs max-sm:justify-center">
              <a
                href={`${landingExternalLinks.marketGitHub}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md transition-colors duration-300 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Licenses
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            </div>
          </div>
        </div>

        <div
          aria-hidden="true"
          className="-translate-x-1/2 -translate-y-8 absolute left-1/2 z-0 hidden w-full overflow-hidden sm:block"
        >
          <FooterHoverText text={landingProduct.footerHoverText} />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3"
            style={{
              background: "linear-gradient(to bottom, transparent, hsl(var(--background)))"
            }}
          />
        </div>
      </div>
    </footer>
  );
}
