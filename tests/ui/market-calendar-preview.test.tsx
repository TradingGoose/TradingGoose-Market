// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketCalendarPreview } from "../../app/(landing)/components/market-calendar-preview";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

describe("Market calendar preview", () => {
  it("changes the date, session times and holiday state together", async () => {
    const interaction = userEvent.setup();
    render(<MarketCalendarPreview />);
    expect(screen.getByText("09:30–16:00")).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: /Market holiday/ }));
    expect(screen.getByRole("combobox", { name: "Trading calendar date" }).textContent).toBe("Nov 26, 2026");
    expect(screen.getByText("Thanksgiving Day")).toBeTruthy();
    expect(screen.queryByText("09:30–16:00")).toBeNull();
    await interaction.click(screen.getByRole("button", { name: /Early close/ }));
    expect(screen.getByText("09:30–13:00")).toBeTruthy();
    expect(screen.queryByText("Thanksgiving Day")).toBeNull();
    await interaction.click(screen.getByRole("combobox", { name: "Trading calendar date" }));
    await interaction.click(screen.getByRole("option", { name: "Nov 2, 2026" }));
    expect(screen.getByText("09:30–16:00")).toBeTruthy();
  });

});
