// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ registrationMode: "open" }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => runtime }));
vi.mock("@/app/fonts/soehne/soehne", () => ({ soehne: { className: "soehne" } }));
vi.mock("@/app/(landing)/components/hero/market-globe", () => ({ MarketGlobe: () => <div data-testid="market-globe" /> }));
vi.mock("@/app/(landing)/actions/github", () => ({ getFormattedGitHubStars: vi.fn(async () => "0") }));
vi.mock("@/app/(landing)/components/footer/landing-footer", () => ({
  default: () => <footer data-surface="footer">Market footer</footer>,
}));
vi.mock("@/app/(landing)/components/structured-data", () => ({
  StructuredData: () => <script data-testid="structured-data" />,
}));
vi.mock("@/app/(landing)/site-url", () => ({
  isLandingSiteUrlConfigured: () => true,
}));

import Landing from "../../app/(landing)/landing";
import Background from "../../app/(landing)/components/background/landing-background";
import { LandingNav } from "../../app/(landing)/components/nav/landing-nav";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  runtime.registrationMode = "open";
});

describe("Studio-shaped Market landing hierarchy", () => {
  it("renders nav, Market hero, and footer in document flow without viewport clipping", () => {
    const { container } = render(<Background><Landing /></Background>);
    expect(container.querySelector("nav")).toBeTruthy();
    expect(container.querySelector("main > section")).toBeTruthy();
    const outerBackground = container.firstElementChild?.firstElementChild;
    expect(outerBackground?.querySelectorAll(".cell")).toHaveLength(405);
    expect(container.firstElementChild?.className).not.toContain("h-svh");
    expect(container.firstElementChild?.className).not.toContain("overflow-hidden");
    expect(container.querySelector("main")?.parentElement?.className).not.toContain("bg-background");
    expect(screen.getByTestId("market-globe").parentElement?.parentElement?.className).not.toContain("absolute");
    expect(screen.getByText("Market footer")).toBeTruthy();
    expect(screen.getByTestId("structured-data")).toBeTruthy();
  });

  it("preserves the original hero before the new product sections", () => {
    const { container } = render(<Landing />);
    const hero = container.querySelector("main > section") as HTMLElement;
    expect(hero).toBeTruthy();
    expect(within(hero).getByRole("heading", { level: 1 }).textContent).toBe("Get market hours from TradingGoose");
    expect(within(hero).getByTestId("market-globe")).toBeTruthy();

    const productSections = [
      "market-hours",
      "listing-identities",
      "trading-calendars",
      "reference-data",
      "developers",
      "access-and-usage",
    ];
    for (const id of productSections) {
      const section = container.querySelector(`section#${id}`);
      expect(section).toBeTruthy();
      expect(section?.querySelector("h2")).toBeTruthy();
      expect(hero.contains(section)).toBe(false);
      expect(hero.compareDocumentPosition(section as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    const closing = container.querySelector("section#get-started");
    const lastProductSection = container.querySelector("section#access-and-usage") as HTMLElement;
    expect(closing).toBeTruthy();
    expect(hero.contains(closing)).toBe(false);
    expect(lastProductSection.compareDocumentPosition(closing as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const listingSection = container.querySelector("section#listing-identities") as HTMLElement;
    const groupedSections = listingSection.parentElement as HTMLElement;
    const featureGroup = groupedSections.parentElement as HTMLElement;
    const overview = container.querySelector("section#market-hours") as HTMLElement;
    expect(Array.from(groupedSections.children).map((section) => section.id)).toEqual([
      "listing-identities",
      "trading-calendars",
      "reference-data",
      "developers",
      "access-and-usage",
    ]);
    expect(featureGroup.querySelector(':scope > [aria-hidden="true"]')).toBeTruthy();
    expect(featureGroup.contains(overview)).toBe(false);
    expect(featureGroup.contains(closing)).toBe(false);
    expect(featureGroup.parentElement).toBe(overview.parentElement?.parentElement);
    expect(featureGroup.parentElement).toBe(closing?.parentElement);
  });

  it("links to Market resources on desktop and mobile and closes the mobile navigation after a link or desktop resize", async () => {
    const interaction = userEvent.setup();
    vi.stubGlobal("innerWidth", 375);
    render(<Landing />);
    const nav = within(screen.getByRole("navigation", { name: "Primary navigation" }));
    const resources = [
      ["Hours", "/#market-hours", false],
      ["Listings", "/#listing-identities", false],
      [/^TradingGoose Market source repository/, "https://github.com/TradingGoose/TradingGoose-Market", true],
    ] as const;

    for (const [name, href, external] of resources) {
      const link = nav.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      if (external) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
      } else {
        expect(link.hasAttribute("target")).toBe(false);
        expect(link.hasAttribute("rel")).toBe(false);
      }
    }

    expect(screen.queryByRole("link", { name: /^View source/i })).toBeNull();
    const heroSource = screen.getByRole("link", { name: /^Open Source on GitHub/ });
    expect(heroSource.getAttribute("href")).toBe("https://github.com/TradingGoose/TradingGoose-Market");
    expect(heroSource.getAttribute("target")).toBe("_blank");
    expect(heroSource.getAttribute("rel")).toContain("noopener");
    expect(nav.queryByRole("link", { name: /^Docs/ })).toBeNull();
    expect(nav.queryByRole("link", { name: /^Blog/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /guide/i })).toBeNull();

    const menuButton = nav.getByRole("button", { name: "Menu" });
    await interaction.click(menuButton);
    const dialog = within(await screen.findByRole("dialog", { name: "Mobile navigation" }));
    const mobileNav = within(dialog.getByRole("navigation", { name: "Mobile navigation" }));
    for (const [name, href, external] of resources) {
      const link = mobileNav.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      if (external) {
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
      } else {
        expect(link.hasAttribute("target")).toBe(false);
        expect(link.hasAttribute("rel")).toBe(false);
      }
    }

    await interaction.click(mobileNav.getByRole("link", { name: "Listings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mobile navigation" })).toBeNull());
    expect(document.activeElement).toBe(menuButton);

    await interaction.click(menuButton);
    await screen.findByRole("dialog", { name: "Mobile navigation" });
    vi.stubGlobal("innerWidth", 768);
    fireEvent.resize(window);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mobile navigation" })).toBeNull());
  });

  it("changes API examples with pointer and arrow-key navigation while preserving the public contracts", async () => {
    const interaction = userEvent.setup();
    render(<Landing />);
    const tabs = within(screen.getByRole("tablist", { name: "API request examples" }));
    const search = tabs.getByRole("tab", { name: "Search" });
    const listing = tabs.getByRole("tab", { name: "Listing" });
    const hours = tabs.getByRole("tab", { name: "Market hours" });

    expect(search.getAttribute("aria-selected")).toBe("true");
    expect(within(screen.getByRole("tabpanel", { name: "Search" })).getByText("/api/search/listings?version=v1&search_query=AAPL")).toBeTruthy();
    const searchResponse = JSON.parse(screen.getByRole("region", { name: "Search example JSON response" }).textContent ?? "");
    expect(within(screen.getByRole("tabpanel", { name: "Search" })).getByText("Example JSON response")).toBeTruthy();
    expect(searchResponse.data[0]).toMatchObject({ listing_id: "{listing_id}", base: "AAPL", primaryMicCode: "XNAS" });

    await interaction.click(listing);
    expect(listing.getAttribute("aria-selected")).toBe("true");
    expect(search.getAttribute("aria-selected")).toBe("false");
    expect(within(screen.getByRole("tabpanel", { name: "Listing" })).getByText("/api/get/listing?version=v1&listing_id={listing_id}")).toBeTruthy();
    const listingResponse = JSON.parse(screen.getByRole("region", { name: "Listing example JSON response" }).textContent ?? "");
    expect(listingResponse.data).toMatchObject({ listing_id: "{listing_id}", base: "AAPL", timeZoneName: "America/New_York" });

    await interaction.keyboard("{ArrowRight}");
    const hoursPanel = within(await screen.findByRole("tabpanel", { name: "Market hours" }));
    expect(hours.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(hours);
    expect(hoursPanel.getByText("/api/get/market-hours?version=v1&listing_id={listing_id}&listingType=default&date=2026-11-02")).toBeTruthy();
    const hoursResponse = JSON.parse(screen.getByRole("region", { name: "Market hours example JSON response" }).textContent ?? "");
    expect(hoursResponse.data.isHoliday).toBe(false);
    expect(hoursResponse.data.timeZone).toMatchObject({ name: "America/New_York", utcOffset: "-05:00" });
    expect(hoursResponse.data.marketHors.market).toEqual({ start: "09:30", end: "16:00" });
  });

  it.each(["open", "close"])("mirrors desktop and mobile registration actions for registration=%s", async (mode) => {
    const interaction = userEvent.setup();
    const registrationOpen = mode === "open";
    runtime.registrationMode = mode;
    const { container } = render(<Landing />);
    const loginLinks = screen.queryAllByRole("link", { name: "Log in" });
    expect(loginLinks).toHaveLength(registrationOpen ? 1 : 0);
    expect(loginLinks.every((link) => link.getAttribute("href") === "/login")).toBe(true);
    const signupLinks = screen.queryAllByRole("link", { name: "Get started" });
    expect(signupLinks).toHaveLength(registrationOpen ? 2 : 0);
    expect(signupLinks.every((link) => link.getAttribute("href") === "/signup")).toBe(true);
    const comingSoon = screen.queryAllByRole("button", { name: "Coming soon" });
    expect(comingSoon).toHaveLength(registrationOpen ? 0 : 2);
    expect(comingSoon.every((button) => button.hasAttribute("disabled") && !button.querySelector("a"))).toBe(true);

    const closing = within(container.querySelector("section#get-started") as HTMLElement);
    expect(closing.getAllByRole("link")).toHaveLength(1);
    const community = closing.getByRole("link", { name: /^Join Discord/ });
    expect(community.getAttribute("href")).toBe("https://discord.gg/wavf5JWhuT");
    expect(community.getAttribute("target")).toBe("_blank");
    expect(community.getAttribute("rel")).toContain("noopener");
    expect(community.getAttribute("rel")).toContain("noreferrer");
    expect(closing.queryByRole("button", { name: "Coming soon" })).toBeNull();
    expect(closing.queryByRole("link", { name: "Get started" })).toBeNull();

    await interaction.click(screen.getByRole("button", { name: "Menu" }));
    const menu = within(await screen.findByRole("dialog", { name: "Mobile navigation" }));
    if (registrationOpen) {
      expect(menu.getByRole("link", { name: "Log in" }).getAttribute("href")).toBe("/login");
      expect(menu.getByRole("link", { name: "Get started" }).getAttribute("href")).toBe("/signup");
      expect(menu.queryByText("Coming soon")).toBeNull();
    } else {
      expect(menu.getByRole("button", { name: "Coming soon" }).hasAttribute("disabled")).toBe(true);
      expect(menu.queryByRole("link", { name: "Log in" })).toBeNull();
      expect(menu.queryByRole("link", { name: "Get started" })).toBeNull();
    }
  });

  it("removes landing authentication links when registration closes", () => {
    runtime.registrationMode = "open";
    const { rerender } = render(<Landing />);
    expect(screen.getAllByRole("link", { name: "Get started" })).toHaveLength(2);
    runtime.registrationMode = "close";
    rerender(<Landing />);
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Get started" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Coming soon" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
  });

  it("uses Studio's brand-only navigation on auth pages", () => {
    render(<LandingNav variant="auth" />);
    expect(screen.getByRole("link", { name: "TradingGoose Market home" }).querySelector("img")?.getAttribute("src")).toBe("/icon.svg");
    expect(screen.queryByRole("link", { name: "Log in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  });
});
