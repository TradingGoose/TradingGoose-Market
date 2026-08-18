// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/(landing)/components/hero/market-hero", () => ({
  default: () => <section data-surface="hero">Market hero</section>,
}));
vi.mock("@/app/(landing)/components/nav/landing-nav", () => ({
  LandingNav: () => <nav data-surface="nav">Market nav</nav>,
}));
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

afterEach(cleanup);

describe("Studio-shaped Market landing hierarchy", () => {
  it("renders nav, Market hero, and footer in document flow without viewport clipping", () => {
    const { container } = render(<Landing />);
    expect(
      Array.from(container.querySelectorAll("[data-surface]")).map((node) =>
        node.getAttribute("data-surface"),
      ),
    ).toEqual(["nav", "hero", "footer"]);
    expect(container.firstElementChild?.className).toContain("min-h-screen");
    expect(container.firstElementChild?.className).not.toContain("overflow-hidden");
    expect(screen.getByText("Market footer")).toBeTruthy();
    expect(screen.getByTestId("structured-data")).toBeTruthy();
  });
});
