// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MarketAccountPreview } from "../../app/(landing)/components/market-account-preview";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe("Market account preview", () => {
  it("shows masked keys with optional limits on API charges", () => {
    render(<MarketAccountPreview />);

    expect(screen.getByRole("region", { name: "Market account preview" })).toBeTruthy();
    const table = within(screen.getByRole("table", { name: "API keys" }));
    const production = table.getByRole("row", { name: /Production/ });
    const research = table.getByRole("row", { name: /Research/ });
    expect(production.textContent).toContain("•••• •••• 8f2a");
    expect(production.textContent).toContain("No limit");
    expect(production.textContent).not.toContain("days");
    expect(research.textContent).toContain("$50");
    expect(research.textContent).toContain("Over the past 7 days");
  });

  it("changes activity totals and endpoint counts with its period filter", async () => {
    const interaction = userEvent.setup();
    render(<MarketAccountPreview />);
    await interaction.click(screen.getByRole("tab", { name: "Activity" }));
    const panel = screen.getByRole("tabpanel", { name: "Activity" });

    const metric = (label: string) => within(panel).getByText(label).parentElement?.querySelector("dd")?.textContent;
    expect(metric("Requests")).toBe("8");
    expect(metric("Successes")).toBe("5");
    expect(metric("Errors")).toBe("2");
    expect(within(panel).getByText("1 pending outcome")).toBeTruthy();
    await interaction.click(screen.getByRole("combobox", { name: "Activity period" }));
    await interaction.click(screen.getByRole("option", { name: "Oct 30 UTC" }));
    expect(metric("Requests")).toBe("4");
    expect(metric("Successes")).toBe("3");
    expect(metric("Errors")).toBe("1");
    expect(within(panel).getByText("0 pending outcomes")).toBeTruthy();
    const ranking = within(panel).getByRole("list", { name: "Requests by endpoint" });
    expect(within(ranking).getByText("/api/search/listings").parentElement?.textContent).toBe("/api/search/listings1");
  });

  it("filters logs by completion outcome and expands stored metadata", async () => {
    const interaction = userEvent.setup();
    render(<MarketAccountPreview />);
    await interaction.click(screen.getByRole("tab", { name: "Logs" }));
    await interaction.click(screen.getByRole("combobox", { name: "Log outcome" }));
    await interaction.click(screen.getByRole("option", { name: "Server error" }));
    const table = screen.getByRole("table", { name: "Request logs" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("500").textContent).toContain("Server error");
    expect(screen.getByText("1 request")).toBeTruthy();
    const expand = within(table).getByRole("button", { name: "Request details 16:00:12" });
    await interaction.click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(within(table).getByText("Research notebook")).toBeTruthy();
    expect(within(table).getByText("Research")).toBeTruthy();
    expect(within(table).getByText("GET")).toBeTruthy();
    expect(within(table).getByText(/Oct 29, 2026/)).toBeTruthy();
    await interaction.click(expand);
    expect(within(table).queryByText("Research notebook")).toBeNull();

    await interaction.click(screen.getByRole("combobox", { name: "Log outcome" }));
    await interaction.click(screen.getByRole("option", { name: "Client error" }));
    expect(within(table).getByText("404").textContent).toContain("Client error");
    expect(within(table).getByText("/api/get/listing")).toBeTruthy();
  });

  it("switches account panels with arrow keys", async () => {
    const interaction = userEvent.setup();
    render(<MarketAccountPreview />);
    const tabs = within(screen.getByRole("tablist", { name: "Market account" }));
    tabs.getByRole("tab", { name: "API Keys" }).focus();
    await interaction.keyboard("{ArrowRight}");
    expect(tabs.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel", { name: "Activity" })).toBeTruthy();
    await interaction.keyboard("{End}");
    expect(tabs.getByRole("tab", { name: "Logs" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("table", { name: "Request logs" })).toBeTruthy();
  });
});
