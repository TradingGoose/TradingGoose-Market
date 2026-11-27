// @vitest-environment jsdom
import { focusManager, useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { QueryProvider } from "@/components/billing/query-provider";
import { billingSettingsKeys, notificationMutationOptions, refreshPreferences, useBillingPreferences } from "@/hooks/queries/billing-settings";
import { refreshSubscription, subscriptionKeys, subscriptionMutationOptions, useSubscriptionData, useUsageLimitData } from "@/hooks/queries/subscription";
import type { BillingSummary, UsageLimitInfo } from "@/lib/account/contracts";
import { account, baseSummary, billingFixture, billingPath, editLimit, limitPath, prefPath, release, renderSettings, reopen, wrapper } from "../helpers/billing-ui";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); focusManager.setFocused(undefined); });
type Operation = "limit" | "preference";
const operations: Operation[] = ["limit", "preference"];
const prefKey = billingSettingsKeys.settings(account.id);
const key = (op: Operation) => op === "limit" ? subscriptionKeys.usage() : prefKey;
function fixture() {
  const f = billingFixture({ currentPeriodCostUsd: "25", usageLimit: { currentLimitUsd: "25", isExceeded: true, percentUsed: 100, status: "exceeded" } });
  const renders: Record<Operation, number[]> = { limit: [], preference: [] };
  function useAccount() {
    useSubscriptionData(); useUsageLimitData(); useBillingPreferences(account.id);
    const pendingLimit = useIsMutating({ mutationKey: subscriptionKeys.usage() });
    const pendingPref = useIsMutating({ mutationKey: prefKey });
    renders.limit.push(pendingLimit); renders.preference.push(pendingPref);
    const limit = useMutation(subscriptionMutationOptions.updateUsageLimit(f.client));
    const pref = useMutation(notificationMutationOptions(f.client, account.id));
    return (op: Operation) => op === "limit" ? limit.mutateAsync("100") : pref.mutateAsync(false);
  }
  const mount = () => renderHook(useAccount, { wrapper: wrapper(f.client) });
  const observer = mount();
  const summary = () => f.client.getQueryData<BillingSummary>(subscriptionKeys.user())!;
  const metadata = () => f.client.getQueryData<{ usageLimit: UsageLimitInfo }>(subscriptionKeys.usage())!.usageLimit.currentLimitUsd;
  const preference = () => f.client.getQueryData<{ billingUsageNotificationsEnabled: boolean }>(prefKey)!.billingUsageNotificationsEnabled;
  return { ...f, renders, observer, mount, summary, metadata, preference,
    start: (op: Operation) => observer.result.current(op).then(() => true, () => false),
    holdWrite: (op: Operation) => op === "limit" ? f.hold("PUT", limitPath) : f.hold("PATCH", prefPath),
    refresh: (op: Operation) => op === "limit" ? refreshSubscription(f.client) : refreshPreferences(f.client, account.id),
    counts: () => [billingPath, limitPath, prefPath].map(path => f.count("GET", path)),
  };
}
for (const op of operations) {
  it.each(["fast", "early refresh", "rendered pending"])("%s confirms " + op + " with mounted observers", async timing => {
    const f = fixture(), gate = f.holdWrite(op);
    const other = op === "limit" ? "preference" : "limit";
    let done!: Promise<boolean>;
    await act(async () => {
      done = f.start(op);
      await gate.entered;
      expect(f.client.isMutating({ mutationKey: key(op) })).toBe(1);
      expect(f.renders[op]).not.toContain(1);
      if (timing === "early refresh") {
        await f.refresh(op);
        expect(f.counts()).toEqual([0, 0, 0]);
        expect(op === "limit" ? f.metadata() : f.preference()).toBe(op === "limit" ? "100" : false);
      }
      if (timing !== "rendered pending") { gate.resolve(); expect(await done).toBe(true); }
    });
    if (timing === "rendered pending") {
      await waitFor(() => expect(f.renders[op]).toContain(1));
      await act(async () => { await f.refresh(op); await f.refresh(other); });
      expect(f.counts()).toEqual(op === "limit" ? [0, 0, 1] : [1, 1, 0]);
      expect(op === "limit" ? f.metadata() : f.preference()).toBe(op === "limit" ? "100" : false);
      await act(async () => { gate.resolve(); expect(await done).toBe(true); });
    } else {
      expect(f.renders[op]).not.toContain(1);
    }
    const expected = timing === "rendered pending" ? [1, 1, 1] : op === "limit" ? [1, 1, 0] : [0, 0, 1];
    await waitFor(() => expect(f.counts()).toEqual(expected));
    if (op === "limit") expect(f.summary().usageLimit).toMatchObject({ currentLimitUsd: "100", status: "ok", isExceeded: false });
    else expect(f.preference()).toBe(false);
  });
}
for (const first of operations) {
  it.each([[true, true], [true, false], [false, true], [false, false]])(
    first + " settles first (limit=%s, preference=%s)", async (limitOk, prefOk) => {
      const f = fixture(), other = first === "limit" ? "preference" : "limit";
      const ok = { limit: limitOk, preference: prefOk };
      const gates = { limit: f.holdWrite("limit"), preference: f.holdWrite("preference") };
      let done!: Record<Operation, Promise<boolean>>;
      await act(async () => {
        done = { limit: f.start("limit"), preference: f.start("preference") };
        await Promise.all([gates.limit.entered, gates.preference.entered]);
        await Promise.all([f.refresh("limit"), f.refresh("preference")]);
      });
      await waitFor(() => expect(f.renders.preference).toContain(1));
      act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
      const additionalObserver = f.mount();
      expect(f.counts()).toEqual([0, 0, 0]);
      expect([f.summary().usageLimit.currentLimitUsd, f.metadata(), f.preference()]).toEqual(["100", "100", false]);
      await release(gates[first], ok[first]);
      expect(await done[first]).toBe(ok[first]);
      expect(f.client.isMutating({ mutationKey: key(other) })).toBe(1);
      expect(first === "limit" ? f.preference() : f.metadata()).toBe(first === "limit" ? false : "100");
      expect(f.count("GET", first === "limit" ? prefPath : limitPath)).toBe(0);
      await release(gates[other], ok[other]);
      expect(await done[other]).toBe(ok[other]);
      await waitFor(() => expect(f.counts()).toEqual([1, 1, prefOk ? 1 : 0]));
      expect(f.summary().usageLimit.currentLimitUsd).toBe(limitOk ? "100" : "25");
      expect(f.metadata()).toBe(limitOk ? "100" : "25");
      expect(f.preference()).toBe(!prefOk);
      additionalObserver.unmount();
    });
}
it("shares reads, disables focus refetch and observes the two stale intervals on remount", async () => {
  const f = billingFixture();
  const past = Date.now() - 40_000;
  for (const k of [subscriptionKeys.user(), subscriptionKeys.usage(), prefKey]) f.client.setQueryData(k, f.client.getQueryData(k), { updatedAt: past });
  const useReads = () => { useSubscriptionData(); useUsageLimitData(); useBillingPreferences(account.id); };
  const first = renderHook(useReads, { wrapper: wrapper(f.client) });
  const other = renderHook(useReads, { wrapper: wrapper(f.client) });
  await waitFor(() => expect(f.count("GET", limitPath)).toBe(1));
  expect(f.count("GET", billingPath)).toBe(1);
  expect(f.count("GET", prefPath)).toBe(0);
  act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
  expect(f.count("GET", limitPath)).toBe(1);
  first.unmount(); other.unmount();
  f.client.setQueryData(prefKey, f.client.getQueryData(prefKey), { updatedAt: Date.now() - 3_600_001 });
  renderHook(useReads, { wrapper: wrapper(f.client) });
  await waitFor(() => expect(f.count("GET", prefPath)).toBe(1));
  expect(f.count("GET", billingPath)).toBe(1);
});
it("ignores a canceled GET that resolves after optimism and confirmation", async () => {
  const f = fixture(), read = f.hold("GET", billingPath);
  let obsolete!: Promise<unknown>;
  await act(async () => { obsolete = f.refresh("limit"); await read.entered; });
  const signal = f.fetcher.mock.calls.find(([url]) => url === billingPath)![1]!.signal;
  await act(async () => { await f.start("limit"); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { read.resolve(Response.json(baseSummary)); await obsolete; });
  expect(f.metadata()).toBe("100");
  expect(f.summary().usageLimit.currentLimitUsd).toBe("100");
});
it("replacing the personal provider disposes its private client and cannot publish the old response", async () => {
  const f = billingFixture(), old = f.hold("GET", billingPath);
  function Identity() {
    const client = useQueryClient();
    const { data } = useSubscriptionData();
    return <span data-queries={client.getQueryCache().getAll().length}>{data?.currentPeriodCostUsd ?? "pending"}</span>;
  }
  const { rerender } = render(<QueryProvider key="old"><Identity /></QueryProvider>);
  await old.entered;
  f.server.summary = { ...baseSummary, currentPeriodCostUsd: "9" };
  rerender(<QueryProvider key="new"><Identity /></QueryProvider>);
  await screen.findByText("9");
  await act(async () => { old.resolve(Response.json(baseSummary)); });
  expect(screen.getByText("9")).toBeTruthy();
});
it("an actually remounted dialog honors the existing matching mutation before any new submission", async () => {
  const f = billingFixture(), save = f.hold("PUT", limitPath);
  renderSettings(f.client);
  editLimit("50");
  await save.entered;
  await reopen();
  expect(f.client.isMutating({ mutationKey: subscriptionKeys.usage() })).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(f.count("GET", limitPath)).toBe(0);
  expect(f.count("PUT", limitPath)).toBe(1);
  await release(save);
  expect(await screen.findByRole("button", { name: "Edit limit" })).toBeTruthy();
  await waitFor(() => expect(f.count("GET", limitPath)).toBe(1));
});
it("rejects submissions synchronously against a different observer before pending controls render", async () => {
  const f = billingFixture();
  renderSettings(f.client);
  fireEvent.click(screen.getByRole("button", { name: "Edit limit" }));
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value: "100" } });
  const gate = f.hold("PUT", limitPath), preference = f.hold("PATCH", prefPath);
  await act(async () => {
    const limit = f.client.getMutationCache().build(f.client, subscriptionMutationOptions.updateUsageLimit(f.client)).execute("50");
    const pref = f.client.getMutationCache().build(f.client, notificationMutationOptions(f.client, account.id)).execute(false);
    expect(input.hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("switch"));
    await Promise.all([gate.entered, preference.entered]);
    expect(f.client.isMutating()).toBe(2);
    expect([f.count("PUT", limitPath), f.count("PATCH", prefPath)]).toEqual([1, 1]);
    gate.resolve(); preference.resolve(); await Promise.all([limit, pref]);
  });
  expect(f.server.limit.currentLimitUsd).toBe("50");
});
it("keeps financial observers connected through Strict Mode effect setup and cleanup", async () => {
  const f = billingFixture();
  function Observer() {
    const { data } = useSubscriptionData();
    const client = useQueryClient();
    return <button onClick={() => void refreshSubscription(client)}>{data?.currentPeriodCostUsd ?? "loading"}</button>;
  }
  render(<StrictMode><QueryProvider><Observer /></QueryProvider></StrictMode>);
  await screen.findByRole("button", { name: "4" });
  f.server.summary = { ...baseSummary, currentPeriodCostUsd: "9" };
  fireEvent.click(screen.getByRole("button", { name: "4" }));
  await screen.findByRole("button", { name: "9" });
});
