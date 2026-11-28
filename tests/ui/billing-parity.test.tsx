// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UsageHeader } from "@/components/billing/usage-header";
import { subscriptionKeys } from "@/hooks/queries/subscription";
import { baseSummary, billingFixture, editLimit, limitPath, release, renderSettings, reopen } from "../helpers/billing-ui";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([[0.4, 0], [28, 3], [87.4, 7], [87.6, 8], [110, 8]])("renders eight source pills at %s percent", (percentUsed, filled) => {
  render(<UsageHeader data={{ ...baseSummary, usageLimit: { ...baseSummary.usageLimit, percentUsed } }} />);
  const bar = screen.getByRole("progressbar");
  expect(bar.children).toHaveLength(8);
  const colors = Array.from(bar.children, node => (node as HTMLElement).style.backgroundColor);
  expect(colors.slice(0, filled)).toEqual(Array(filled).fill(filled === 8 ? "rgb(239, 68, 68)" : "rgb(255, 204, 0)"));
  expect(new Set(colors.slice(filled)).size).toBe(filled === 8 ? 0 : 1);
  expect(bar.getAttribute("aria-valuenow")).toBe(String(Math.min(100, Math.round(percentUsed))));
});
it("gives blocked feedback priority, even over an exceeded zero limit", () => {
  const zero = { ...baseSummary, usageLimit: { currentLimitUsd: "0", percentUsed: 0, status: "exceeded" as const, isExceeded: true } };
  const { rerender } = render(<UsageHeader data={zero} />);
  expect(screen.getByText(/Usage limit exceeded/)).toBeTruthy();
  rerender(<UsageHeader data={{ ...zero, billingBlocked: true }} onResolvePayment={vi.fn()} />);
  expect(screen.getByText("Payment required")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Resolve payment" })).toBeTruthy();
  expect(screen.queryByText(/Usage limit exceeded/)).toBeNull();
  rerender(<UsageHeader data={{ ...zero, usageLimit: { ...zero.usageLimit, status: "warning", percentUsed: 80.3 } }} />);
  expect(screen.getByText("80% of your limit used.")).toBeTruthy();
});
it("selects the denominator and handles Escape, invalid edits, usage floors, blur and fractional saves", async () => {
  const select = vi.spyOn(HTMLInputElement.prototype, "select");
  const f = billingFixture({ currentPeriodCostUsd: "20" }, { minimumLimitUsd: "10" });
  renderSettings(f.client);
  await waitFor(() => expect(screen.getByRole("button", { name: "Close" }).hasAttribute("disabled")).toBe(false));
  const start = (value: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Edit limit" }));
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value } });
    return input;
  };
  const draft = start("30");
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  expect(draft.value).toBe("25");
  fireEvent.keyDown(draft, { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(select).toHaveBeenCalled();
  select.mockRestore();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  for (const value of ["", "9", "25"]) fireEvent.keyDown(start(value), { key: "Enter" });
  fireEvent.keyDown(start("11"), { key: "Enter" });
  expect(screen.getByRole("alert").textContent).toContain("Limit cannot be below current usage");
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input).toHaveProperty("value", "12");
  expect(screen.getByRole("alert").textContent).toContain("Limit cannot be below current usage");
  fireEvent.change(input, { target: { value: "40.9" } });
  expect(input.validity.stepMismatch).toBe(false);
  expect(screen.getByRole("alert").textContent).toContain("Limit cannot be below current usage");
  const check = screen.getByRole("button", { name: "Save limit" });
  fireEvent.blur(input, { relatedTarget: check });
  expect(f.count("PUT", limitPath)).toBe(0);
  fireEvent.click(check);
  await screen.findByText("$40.9");
  fireEvent.blur(start("42"));
  await screen.findByText("$42");
  expect(f.count("PUT", limitPath)).toBe(2);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it.each([
  ["0.000000001", null], ["25.75", null], ["25.75", "25.7500"],
])("preserves an unchanged API limit of %s on blur with draft %s", async (currentLimitUsd, draft) => {
  const f = billingFixture({ currentPeriodCostUsd: "0" }, { currentLimitUsd, minimumLimitUsd: "0" });
  renderSettings(f.client);
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  const openedValue = input.value;
  if (draft) fireEvent.change(input, { target: { value: draft } });
  fireEvent.blur(input);
  await screen.findByRole("button", { name: "Edit limit" });
  expect(f.count("PUT", limitPath)).toBe(0);
  expect(openedValue).toBe(currentLimitUsd);
});
it.each(["1e2", "3E-2", "25.1234567891", "-0.01"])("discards invalid decimal input %s without changing the limit", async value => {
  const f = billingFixture({ currentPeriodCostUsd: "0" }, { minimumLimitUsd: "0" });
  renderSettings(f.client);
  editLimit(value);
  await screen.findByRole("button", { name: "Edit limit" });
  expect(f.count("PUT", limitPath)).toBe(0);
  expect(f.server.limit.currentLimitUsd).toBe("25");
});
it.each([
  ["9007199254740993.123456789", "0", "0", "9007199254740993.123456789"],
  ["0.000000001", "0.000000001", "0.000000001", "0.000000001"],
  [".1250", "0.124999999", "0.125", "0.125"],
])("saves %s exactly at or above the usage and allowance floors", async (draft, currentPeriodCostUsd, minimumLimitUsd, expected) => {
  const f = billingFixture({ currentPeriodCostUsd }, { minimumLimitUsd });
  renderSettings(f.client);
  editLimit(draft);
  await screen.findByRole("button", { name: "Edit limit" });
  expect(f.server.limit.currentLimitUsd).toBe(expected);
  expect(f.count("PUT", limitPath)).toBe(1);
});
it.each([
  { initial: "0", draft: null, key: "ArrowUp", minimum: "0", expected: "1" },
  { initial: "25", draft: null, key: "ArrowDown", minimum: "0", expected: "24" },
  { initial: "25.123456789", draft: null, key: "ArrowDown", minimum: "0", expected: "24.123456789" },
  { initial: "25", draft: "9007199254740993.123456789", key: "ArrowUp", minimum: "0", expected: "9007199254740994.123456789" },
  { initial: "0.625", draft: null, key: "ArrowDown", minimum: "0.125", expected: "0.125" },
  { initial: "0.125", draft: null, key: "ArrowDown", minimum: "0.125", expected: "0.125" },
  { initial: "25", draft: "", key: "ArrowUp", minimum: "0.125", expected: "0.125" },
])("steps by one dollar from $initial (draft $draft, $key, minimum $minimum)", async ({ initial, draft, key, minimum, expected }) => {
  const f = billingFixture({ currentPeriodCostUsd: "0" }, { currentLimitUsd: initial, minimumLimitUsd: minimum });
  renderSettings(f.client);
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  const input = screen.getByRole("spinbutton");
  if (draft !== null) fireEvent.change(input, { target: { value: draft } });
  expect(fireEvent.keyDown(input, { key })).toBe(false);
  expect(input).toHaveProperty("value", expected);
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByRole("button", { name: "Edit limit" });
  expect(f.server.limit.currentLimitUsd).toBe(expected);
  expect(f.count("PUT", limitPath)).toBe(expected === initial ? 0 : 1);
});
it("restores the confirmed input on a server error and rejects pre-render duplicate submits", async () => {
  const f = billingFixture();
  renderSettings(f.client);
  const gate = f.hold("PUT", limitPath);
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "50" } });
  act(() => { fireEvent.keyDown(input, { key: "Enter" }); fireEvent.blur(input); });
  await waitFor(() => expect(f.count("PUT", limitPath)).toBe(1));
  await release(gate, false);
  expect(await screen.findByText("Could not update the usage limit.")).toBeTruthy();
  expect(input.value).toBe("25");
});
it.each([true, false])("rejects a second edit after a real close/reopen until the first save settles (success=%s)", async success => {
  const f = billingFixture();
  renderSettings(f.client);
  const gate = f.hold("PUT", limitPath);
  editLimit("50");
  await screen.findByRole("button", { name: "Saving limit" });
  await reopen();
  const busy = screen.getByRole("button", { name: "Saving limit" });
  expect(busy.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false);
  fireEvent.click(busy);
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getByText("$50")).toBeTruthy();
  expect(f.client.isMutating({ mutationKey: subscriptionKeys.usage() })).toBe(1);
  expect(f.count("PUT", limitPath)).toBe(1);
  await release(gate, success);
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit limit" }).hasAttribute("disabled")).toBe(false));
  expect(screen.getByText(success ? "$50" : "$25")).toBeTruthy();
  editLimit("100");
  await screen.findByText("$100");
  expect(f.count("PUT", limitPath)).toBe(2);
});
