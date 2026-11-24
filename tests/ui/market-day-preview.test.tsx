// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketDayPreview } from "../../app/(landing)/components/market-day-preview";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function sessionTable(date: string, zone = "UTC") {
  return screen.getByRole("table", { name: `Trading sessions on ${date} in ${zone}.` });
}

function expectSessions(table: HTMLElement, market: string, ...sessions: string[]) {
  const row = within(table).getByRole("row", { name: new RegExp(market) });
  expect(within(row).getByRole("cell", { name: new RegExp(sessions.join("\\s+")) })).toBeTruthy();
}

describe("Market day preview", () => {
  it("shows three regular markets and their UTC sessions for the selected date", () => {
    render(<MarketDayPreview />);
    expect(screen.getByRole("combobox", { name: "Market hours date" }).textContent).toBe("Nov 2, 2026");
    expect(screen.getByRole("combobox", { name: "Market hours time zone" }).textContent).toBe("UTC");
    const table = sessionTable("Nov 2, 2026");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(3);
    expectSessions(table, "Tokyo", "00:00–02:30", "03:30–06:30");
    expectSessions(table, "London", "08:00–16:30");
    expectSessions(table, "New York", "14:30–21:00");
    for (const market of ["Tokyo", "London", "New York"]) {
      expect(within(table).getByRole("row", { name: new RegExp(`${market}.*Regular`) })).toBeTruthy();
    }
  });

  it("converts each market's sessions to its exchange time", async () => {
    const interaction = userEvent.setup();
    render(<MarketDayPreview />);
    await interaction.click(screen.getByRole("combobox", { name: "Market hours time zone" }));
    await interaction.click(screen.getByRole("option", { name: "Exchange time" }));
    const table = sessionTable("Nov 2, 2026", "each exchange’s local time");
    expectSessions(table, "Tokyo", "09:00–11:30", "12:30–15:30");
    expectSessions(table, "London", "08:00–16:30");
    expectSessions(table, "New York", "09:30–16:00");
  });

  it("closes only New York on the Nasdaq holiday and updates Apple's status", async () => {
    const interaction = userEvent.setup();
    render(<MarketDayPreview />);
    await interaction.click(screen.getByRole("combobox", { name: "Market hours date" }));
    await interaction.click(screen.getByRole("option", { name: "Nov 26, 2026" }));
    const table = sessionTable("Nov 26, 2026");
    expectSessions(table, "New York", "Market closed");
    expect(within(table).getByRole("row", { name: /New York.*Holiday/ })).toBeTruthy();
    expectSessions(table, "Tokyo", "00:00–02:30", "03:30–06:30");
    expectSessions(table, "London", "08:00–16:30");
    expect(within(table).getByRole("row", { name: /Tokyo.*Regular/ })).toBeTruthy();
    expect(within(table).getByRole("row", { name: /London.*Regular/ })).toBeTruthy();
    const preview = within(screen.getByRole("figure"));
    expect(preview.getByText("Apple Inc.")).toBeTruthy();
    expect(preview.getByText("Market holiday")).toBeTruthy();
  });

  it("shortens only New York for the early close in UTC and exchange time", async () => {
    const interaction = userEvent.setup();
    render(<MarketDayPreview />);
    await interaction.click(screen.getByRole("combobox", { name: "Market hours date" }));
    await interaction.click(screen.getByRole("option", { name: "Nov 27, 2026" }));
    const utc = sessionTable("Nov 27, 2026");
    expectSessions(utc, "New York", "14:30–18:00");
    expect(within(utc).getByRole("row", { name: /New York.*Early close/ })).toBeTruthy();
    expectSessions(utc, "Tokyo", "00:00–02:30", "03:30–06:30");
    expectSessions(utc, "London", "08:00–16:30");

    await interaction.click(screen.getByRole("combobox", { name: "Market hours time zone" }));
    await interaction.click(screen.getByRole("option", { name: "Exchange time" }));
    const local = sessionTable("Nov 27, 2026", "each exchange’s local time");
    expectSessions(local, "New York", "09:30–13:00");
    expectSessions(local, "Tokyo", "09:00–11:30", "12:30–15:30");
    expectSessions(local, "London", "08:00–16:30");
    expect(within(local).getByRole("row", { name: /Tokyo.*Regular/ })).toBeTruthy();
    expect(within(local).getByRole("row", { name: /London.*Regular/ })).toBeTruthy();
  });
});
