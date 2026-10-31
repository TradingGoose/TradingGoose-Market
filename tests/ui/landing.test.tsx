// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
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

afterEach(cleanup);

describe("Studio-shaped Market landing hierarchy", () => {
  it("renders nav, Market hero, and footer in document flow without viewport clipping", () => {
    const { container } = render(<Background><Landing /></Background>);
    expect(container.querySelector("nav")).toBeTruthy();
    expect(container.querySelector("main > section")).toBeTruthy();
    expect(container.querySelectorAll(".cell")).toHaveLength(405);
    expect(container.firstElementChild?.className).not.toContain("h-svh");
    expect(container.firstElementChild?.className).not.toContain("overflow-hidden");
    expect(container.querySelector("main")?.parentElement?.className).not.toContain("bg-background");
    expect(screen.getByTestId("market-globe").parentElement?.parentElement?.className).not.toContain("absolute");
    expect(screen.getByText("Market footer")).toBeTruthy();
    expect(screen.getByTestId("structured-data")).toBeTruthy();
  });

  it.each(["open", "close"])("mirrors desktop and mobile registration actions for registration=%s", async (mode) => {
    const interaction = userEvent.setup();
    const registrationOpen = mode === "open";
    runtime.registrationMode = mode;
    render(<Landing />);
    const loginLinks = screen.queryAllByRole("link", { name: "Log in" });
    expect(loginLinks).toHaveLength(registrationOpen ? 1 : 0);
    expect(loginLinks.every((link) => link.getAttribute("href") === "/login")).toBe(true);
    const signupLinks = screen.queryAllByRole("link", { name: "Get started" });
    expect(signupLinks).toHaveLength(registrationOpen ? 2 : 0);
    expect(signupLinks.every((link) => link.getAttribute("href") === "/signup")).toBe(true);
    const comingSoon = screen.queryAllByRole("button", { name: "Coming soon" });
    expect(comingSoon).toHaveLength(registrationOpen ? 0 : 2);
    expect(comingSoon.every((button) => button.hasAttribute("disabled") && !button.querySelector("a"))).toBe(true);

    await interaction.click(screen.getByRole("button", { name: "Menu" }));
    const menu = within(await screen.findByRole("menu"));
    if (registrationOpen) {
      expect(menu.getByRole("menuitem", { name: "Log in" }).getAttribute("href")).toBe("/login");
      expect(menu.getByRole("menuitem", { name: "Get started" }).getAttribute("href")).toBe("/signup");
      expect(menu.queryByText("Coming soon")).toBeNull();
    } else {
      expect(menu.getByRole("menuitem", { name: "Coming soon" }).getAttribute("aria-disabled")).toBe("true");
      expect(menu.queryByRole("menuitem", { name: "Log in" })).toBeNull();
      expect(menu.queryByRole("menuitem", { name: "Get started" })).toBeNull();
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
