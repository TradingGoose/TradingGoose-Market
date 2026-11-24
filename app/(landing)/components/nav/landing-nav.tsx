"use client";

import { useEffect, useState } from "react";
import { MenuIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { soehne } from "@/app/fonts/soehne/soehne";
import { Button, buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import {
  landingGitHubLink,
  landingNavLinks,
  landingProduct
} from "../copy";
import { getFormattedGitHubStars } from "../../actions/github";
import { GitHubMark } from "../social-icons";

export function LandingNav({ registrationOpen, variant = "landing" }: {
  registrationOpen?: boolean;
  variant?: "landing" | "auth";
}) {
  const [githubStars, setGithubStars] = useState("0");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (variant !== "landing") return;
    const timeoutId = window.setTimeout(() => {
      const fetchStars = async () => {
        setGithubStars(await getFormattedGitHubStars());
      };

      void fetchStars();
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [variant]);

  useEffect(() => {
    if (variant !== "landing") return;
    const closeMobileMenuOnDesktop = () => {
      if (window.innerWidth >= 768) setIsMobileMenuOpen(false);
    };
    window.addEventListener("resize", closeMobileMenuOnDesktop);
    return () => window.removeEventListener("resize", closeMobileMenuOnDesktop);
  }, [variant]);

  const registrationActions = (
    <>
      {registrationOpen && <Button variant="ghost" size="sm" className="rounded-md text-base focus-visible:ring-foreground" asChild>
        <Link href="/login" onClick={() => setIsMobileMenuOpen(false)}>Log in</Link>
      </Button>}
      <Button size="sm" className="rounded-md text-base focus-visible:ring-foreground" asChild={registrationOpen} disabled={!registrationOpen}>
        {registrationOpen ? <Link href="/signup" onClick={() => setIsMobileMenuOpen(false)}>Get started</Link> : "Coming soon"}
      </Button>
    </>
  );

  return (
    <nav
      aria-label="Primary navigation"
      className={`${soehne.className} sticky inset-x-0 top-0 z-50 w-full border-border border-b backdrop-blur supports-[backdrop-filter]:bg-background/20`}
      itemScope
      itemType="https://schema.org/SiteNavigationElement"
    >
      <div
        className="mx-auto flex w-full items-center justify-between gap-4 px-4 py-2 sm:px-6 md:px-10"
      >
        <Link
          href="/?from=nav"
          className="flex h-9 items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label="TradingGoose Market home"
          itemProp="url"
          prefetch={false}
        >
          <span itemProp="name" className="sr-only">
            {landingProduct.brand} home
          </span>
          <span
            aria-hidden="true"
            className="flex items-center gap-2 font-semibold text-[18px] text-foreground tracking-tight"
          >
            <Image
              src="/icon.svg"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7"
              priority
              loading="eager"
              quality={100}
            />
            {landingProduct.brand}
          </span>
        </Link>

        {variant === "landing" && <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden items-center gap-6 font-medium text-muted-foreground text-sm md:flex">
            {landingNavLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.external ? "_blank" : undefined}
                rel={link.external ? "noopener noreferrer" : undefined}
                aria-label={link.ariaLabel}
                className="rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span>{link.label}</span>
                {link.external && <span className="sr-only"> (opens in new tab)</span>}
              </a>
            ))}
            <a
              href={landingGitHubLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${landingGitHubLink.ariaLabel} (${githubStars} stars)`}
              className="flex items-center gap-2 rounded-md transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <GitHubMark className="h-4 w-4" aria-hidden="true" />
              <span aria-live="polite">{githubStars}</span>
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
          <Separator orientation="vertical" className="hidden h-6 md:block" />
          <div className="hidden items-center gap-2 md:flex">{registrationActions}</div>

          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden focus-visible:ring-foreground" aria-label="Menu" title="Menu">
                <MenuIcon className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-64 [&>button:not(:focus-visible)]:ring-0 [&>button:not(:focus-visible)]:ring-offset-0 [&>button:focus-visible]:ring-foreground" aria-describedby={undefined}>
              <SheetTitle className="sr-only">Mobile navigation</SheetTitle>
              <nav aria-label="Mobile navigation" className="mt-8">
                <div className="flex flex-col gap-2">
                {landingNavLinks.map((link) => (
                    <a
                      key={link.label}
                      href={link.href}
                      target={link.external ? "_blank" : undefined}
                      rel={link.external ? "noopener noreferrer" : undefined}
                      aria-label={link.ariaLabel}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={buttonVariants({ variant: "ghost", className: "w-full justify-start focus-visible:ring-foreground" })}
                    >
                      <span>{link.label}</span>
                      {link.external && <span className="sr-only"> (opens in new tab)</span>}
                    </a>
                ))}
                  <a
                    href={landingGitHubLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${landingGitHubLink.ariaLabel} (${githubStars} stars)`}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={buttonVariants({ variant: "ghost", className: "w-full justify-start focus-visible:ring-foreground" })}
                  >
                    <GitHubMark className="h-4 w-4" aria-hidden="true" />
                    <span aria-live="polite">{githubStars}</span>
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                  <div className="mt-2 flex flex-col gap-2 border-t pt-4">{registrationActions}</div>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>}
      </div>
    </nav>
  );
}
