import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { expect, vi } from "vitest";
import { SettingsDialog } from "@/components/settings-dialog/settings-dialog";
import { billingSettingsKeys, refreshPreferences } from "@/hooks/queries/billing-settings";
import { refreshSubscription, subscriptionKeys } from "@/hooks/queries/subscription";
import { usageLimitSummary } from "@/lib/account/billing-presentation";
import type { BillingSummary, UsageLimitInfo } from "@/lib/account/contracts";
import { decimalUsdToNanoUsd } from "@/lib/billing/money";

export const account = { id: "user_1", email: "ada@example.test", name: "Ada" };
export const baseSummary: BillingSummary = {
  billingEnabled: true, billingBlocked: false, plan: "payg", status: "active",
  currentPeriodRequestQuantity: 1250, currentPeriodCostUsd: "4", rateUsdPer1000Reads: "0.001",
  grantedOnboardingAllowanceUsd: "18", availableOnboardingAllowanceUsd: "0",
  hasPaidSubscription: true, hasStripeSubscription: true, hasPaymentMethodOnFile: true,
  cancelAtPeriodEnd: false, customerRecoveryState: "ready", nextBillingDate: null,
  activationAvailable: false, portalAvailable: true,
  usageLimit: { currentLimitUsd: "25", percentUsed: 16, isExceeded: false, status: "ok" },
};
export const baseLimit: UsageLimitInfo = { currentLimitUsd: "25", minimumLimitUsd: "18", canEdit: true, updatedAt: null };
export const billingPath = "/api/account/billing";
export const limitPath = billingPath + "/usage-limit";
export const prefPath = billingPath + "/notifications";

export function queryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
}

export function wrapper(client: QueryClient) {
  return function BillingProvider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}

// The transport holds a write before committing it. Reads always see the confirmed server value.
export function billingFixture(overrides: Partial<BillingSummary> = {}, info: Partial<UsageLimitInfo> = {}) {
  const client = queryClient();
  const server = { summary: { ...baseSummary, ...overrides }, limit: { ...baseLimit, ...info }, preference: true };
  const calls: string[] = [];
  const gates = new Map<string, { response: Promise<Response | void>; entered: () => void }>();
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = method + " " + input;
    calls.push(key);
    const gate = gates.get(key);
    if (gate) {
      gates.delete(key);
      gate.entered();
      const response = await gate.response;
      if (response) return response;
    }
    if (method === "PUT" && input === limitPath) {
      const { limitUsd } = JSON.parse(String(init?.body));
      server.limit = { ...server.limit, currentLimitUsd: limitUsd };
      server.summary = { ...server.summary, usageLimit: usageLimitSummary(server.summary.currentPeriodCostUsd,
        server.summary.billingEnabled ? decimalUsdToNanoUsd(limitUsd) : null, server.summary.billingBlocked) };
    }
    if (method === "PATCH" && input === prefPath) {
      server.preference = JSON.parse(String(init?.body)).billingUsageNotificationsEnabled;
    }
    if (input === billingPath) return Response.json(server.summary);
    if (input === limitPath) return Response.json({ usageLimit: server.limit });
    if (input === prefPath) return Response.json({ billingUsageNotificationsEnabled: server.preference });
    if (input.endsWith("/portal")) return Response.json({ url: "#stripe-portal" });
    if (input.endsWith("/activate")) return Response.json({ status: "active" });
    throw new Error("Unexpected test request: " + key);
  });
  vi.stubGlobal("fetch", fetcher);
  function seed() {
    client.setQueryData(subscriptionKeys.user(), server.summary);
    client.setQueryData(subscriptionKeys.usage(), { usageLimit: server.limit });
    client.setQueryData(billingSettingsKeys.settings(account.id), { billingUsageNotificationsEnabled: server.preference });
  }
  seed();
  return { client, calls, server, seed, fetcher,
    hold(method: string, path: string) {
      const wait = deferred<Response | void>();
      const entered = deferred();
      gates.set(method + " " + path, { response: wait.promise, entered: entered.resolve });
      return { ...wait, entered: entered.promise };
    },
    count(method: string, path: string) { return calls.filter(call => call === method + " " + path).length; },
  };
}

export function renderSettings(client: QueryClient) {
  function Settings() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => {
      void refreshSubscription(client);
      void refreshPreferences(client, account.id);
      setOpen(true);
    }}>Open settings</button>
      <SettingsDialog open={open} section="subscription" user={account} onOpenChange={setOpen}
        emailChangeState={{ kind: "none" }} onRefreshUser={async () => account} onRetryEmailChange={async () => {}} /></>;
  }
  return render(<Settings />, { wrapper: wrapper(client) });
}

export function editLimit(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Increase Limit" }));
  const input = screen.getByRole("spinbutton");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}
export async function reopen() {
  const close = screen.getByRole("button", { name: "Close" });
  await waitFor(() => expect(close.hasAttribute("disabled")).toBe(false));
  fireEvent.click(close);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByText("Current")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
}
export function release(gate: ReturnType<ReturnType<typeof billingFixture>["hold"]>, success = true) {
  return act(async () => { gate.resolve(success ? undefined : Response.json({ error: "write failed" }, { status: 409 })); });
}
