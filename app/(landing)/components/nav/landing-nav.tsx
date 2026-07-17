"use client";

import { useEffect, useState } from "react";
import { MenuIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { soehne } from "@/app/fonts/soehne/soehne";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

import {
  landingGitHubLink,
  landingHero,
  landingNavLinks,
  landingProduct
} from "../copy";
import { getFormattedGitHubStars } from "../../actions/github";
import { GitHubMark } from "../social-icons";

export function LandingNav() {
  const [githubStars, setGithubStars] = useState("0");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const fetchStars = async () => {
        setGithubStars(await getFormattedGitHubStars());
      };

      void fetchStars();
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, []);

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
          className="flex h-9 items-center gap-2"
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
              src="/icon.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
            {landingProduct.brand}
          </span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden items-center gap-6 font-medium text-muted-foreground text-sm md:flex">
            {landingNavLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={link.ariaLabel}
                className="flex items-center gap-2 transition-colors hover:text-foreground"
              >
                <span>{link.label}</span>
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            ))}
            <a
              href={landingGitHubLink.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${landingGitHubLink.ariaLabel} (${githubStars} stars)`}
              className="flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <GitHubMark className="h-4 w-4" aria-hidden="true" />
              <span aria-live="polite">{githubStars}</span>
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
          <Separator orientation="vertical" className="hidden h-6 md:block" />
          <div className="hidden items-center gap-2 md:flex">
            <Button size="sm" className="rounded-md text-base" disabled>
              {landingHero.primaryAction.label}
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="md:hidden" asChild>
              <Button variant="outline" size="icon">
                <MenuIcon className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              <DropdownMenuGroup>
                {landingNavLinks.map((link) => (
                  <DropdownMenuItem key={link.label} asChild>
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.ariaLabel}
                      className="flex w-full items-center gap-2"
                    >
                      <span>{link.label}</span>
                      <span className="sr-only"> (opens in new tab)</span>
                    </a>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem asChild>
                  <a
                    href={landingGitHubLink.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${landingGitHubLink.ariaLabel} (${githubStars} stars)`}
                    className="flex w-full items-center gap-2"
                  >
                    <GitHubMark className="h-4 w-4" aria-hidden="true" />
                    <span aria-live="polite">{githubStars}</span>
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="!bg-transparent">
                  <Button size="sm" className="w-full rounded-md text-base" disabled>
                    {landingHero.primaryAction.label}
                  </Button>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
}
