// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  request: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/hooks/use-market-resource", () => ({
  useMarketResource: () => ({ ...market.state, refresh: market.refresh }),
  marketApiRequest: market.request,
}));

import { SubscriptionSettings } from "../../components/settings-dialog/subscription-settings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const base = {
  billingEnabled: true,
  rateUsdPer1000Reads: "1",
  requestNanoUsd: "1000000",
  status: "inactive",
  cancelAtPeriodEnd: false,
  currentPeriodRequestQuantity: "1250",
  currentPeriodCostUsd: "1.25",
  portalAvailable: false,
  activationAvailable: true,
  customerRecoveryState: "ready",
} as const;

function setResource(data: unknown, options?: { loading?: boolean; error?: Error }) {
  market.state = {
    data,
    isLoading: options?.loading ?? false,
    error: options?.error ?? null,
  };
}

describe("Studio-shaped PAYG settings", () => {
  it("keeps key usage available while removing billing actions in disabled mode", () => {
    setResource({ ...base, billingEnabled: false, activationAvailable: false });
    render(<SubscriptionSettings onOpenChange={vi.fn()} />);

    expect(screen.getByText(/Billing is disabled for this Market deployment/i)).toBeTruthy();
    expect(screen.getByText(/API keys and non-billable usage remain available/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Activate PAYG" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Manage Billing/i })).toBeNull();
  });

  it("activates only through the server owner and refreshes authoritative state", async () => {
    const interaction = userEvent.setup();
    setResource(base);
    market.request.mockResolvedValue({ status: "active" });
    render(<SubscriptionSettings onOpenChange={vi.fn()} />);

    expect(screen.getByText("$1 / 1,000 reads")).toBeTruthy();
    expect(screen.getByText("1,250")).toBeTruthy();
    expect(screen.getByText("$1.25")).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "Activate PAYG" }));

    expect(market.request).toHaveBeenCalledWith(
      "/api/account/billing/payg/activate",
      { method: "POST", body: "{}" },
    );
    await waitFor(() => expect(market.refresh).toHaveBeenCalledOnce());
  });

  it("renders exactly one PAYG surface and disables every context action while it is pending", async () => {
    const interaction = userEvent.setup();
    let finishActivation: ((value: { status: string }) => void) | undefined;
    setResource({ ...base, portalAvailable: true });
    market.request.mockReturnValue(new Promise((resolve) => {
      finishActivation = resolve;
    }));
    render(<SubscriptionSettings onOpenChange={vi.fn()} />);

    expect(screen.getAllByText("PAYG")).toHaveLength(1);
    expect(screen.queryByText(/tier|workspace|account usage limit/i)).toBeNull();
    await interaction.click(screen.getByRole("button", { name: "Activate PAYG" }));

    expect((screen.getByRole("button", { name: "Activating…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Manage Billing/i }) as HTMLButtonElement).disabled).toBe(true);

    finishActivation?.({ status: "active" });
    await waitFor(() => expect(market.refresh).toHaveBeenCalledOnce());
  });

  it("shows cancellation/recovery states and keeps Portal failure bounded", async () => {
    const interaction = userEvent.setup();
    setResource({
      ...base,
      status: "active",
      activationAvailable: false,
      portalAvailable: true,
      cancelAtPeriodEnd: true,
      customerRecoveryState: "settlement_pending",
    });
    market.request.mockRejectedValue(new Error("portal unavailable"));
    render(<SubscriptionSettings onOpenChange={vi.fn()} />);

    expect(screen.getByText(/scheduled to cancel at period end/i)).toBeTruthy();
    expect(screen.getByText(/prior billing Customer remains locked/i)).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: /Manage Billing/i }));
    expect(await screen.findByText("The billing portal is unavailable right now.")).toBeTruthy();
  });

  it("renders explicit loading and error states", () => {
    setResource(null, { loading: true });
    const { rerender } = render(<SubscriptionSettings onOpenChange={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading subscription" })).toBeTruthy();
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    setResource(null, { error: new Error("failed") });
    rerender(<SubscriptionSettings onOpenChange={vi.fn()} />);
    expect(screen.getByText("Subscription information is unavailable.")).toBeTruthy();
  });
});
