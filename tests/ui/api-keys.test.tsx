// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  resources: new Map<string, Record<string, unknown>>(),
  request: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/hooks/use-market-resource", async () => {
  class MarketApiError extends Error {
    constructor(public status: number, message = "Market API error") {
      super(message);
    }
  }
  return {
    MarketApiError,
    useMarketResource: (url: string) => ({
      ...(market.resources.get(url) ?? { data: null, error: null, isLoading: false }),
      refresh: market.refresh,
    }),
    marketApiRequest: market.request,
  };
});

import { ApiKeyDetailPage } from "../../components/account/api-keys/api-key-detail-page";
import { ApiKeysPage } from "../../components/account/api-keys/api-keys-page";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { MarketApiKeyDetail, MarketApiKeySummary } from "../../lib/account/contracts";

afterEach(() => {
  cleanup();
  market.resources.clear();
  vi.clearAllMocks();
});

const summary: MarketApiKeySummary = {
  id: "key_1",
  name: "Studio client",
  displayValue: "tg_pub_…4a2f",
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  lastUsedAt: "2026-07-18T00:00:00.000Z",
  totalRequestCount: 1250,
  spendLimitUsd: "5",
  spendWindowDays: 7,
  rollingBillableCostUsd: "6.5",
};

const detail: MarketApiKeyDetail = {
  ...summary,
  spendLimitRevision: 3,
  rollingWindowRequestCount: 800,
  ledgerRemainingUsd: "0",
  ledgerNextCostEligibleAt: "2026-07-19T00:00:00.000Z",
  providerEnforcement: {
    status: "current",
    remainingUsdUpperBound: "0",
    resetAt: "2026-07-20T00:00:00.000Z",
    decision: "rate_limited",
    observedRevision: 3,
    observedAt: "2026-07-18T00:00:00.000Z",
    mayBeMoreRestrictive: true,
  },
};

function billing(enabled: boolean) {
  return {
    billingEnabled: enabled,
    plan: "payg",
    rateUsdPer1000Reads: "1",
    currentPeriodRequestQuantity: 1250,
    currentPeriodCostUsd: "1.25",
    status: enabled ? "active" : null,
    cancelAtPeriodEnd: false,
    customerRecoveryState: "ready",
    activationAvailable: false,
    portalAvailable: enabled,
  };
}

function renderPage(page: React.ReactElement) {
  return render(page, {
    wrapper: ({ children }) => (
      <TooltipProvider delayDuration={0}>{children}</TooltipProvider>
    ),
  });
}

describe("OpenRouter-shaped Market API-key canvases", () => {
  it("renders real key fields, search/count hierarchy, and disabled-billing notice", () => {
    market.resources.set("/api/account/api-keys", {
      data: { keys: [summary] },
      error: null,
      isLoading: false,
    });
    market.resources.set("/api/account/billing", {
      data: billing(false),
      error: null,
      isLoading: false,
    });
    renderPage(<ApiKeysPage />);

    expect(screen.getByRole("heading", { name: "API Keys" })).toBeTruthy();
    expect(screen.getByPlaceholderText("Search API keys")).toBeTruthy();
    expect(screen.getByText("Studio client")).toBeTruthy();
    expect(screen.getByText("$5")).toBeTruthy();
    expect(screen.getByText("7 rolling days")).toBeTruthy();
    expect(screen.getByText("1 of 1 keys")).toBeTruthy();
    expect(screen.getByText(/Saved per-key spend limits remain editable/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/models|tokens|provider credits|guardrails/iu);
  });

  it("renders the finite empty and loading/error canvases", () => {
    market.resources.set("/api/account/api-keys", {
      data: { keys: [] },
      error: null,
      isLoading: false,
    });
    market.resources.set("/api/account/billing", {
      data: billing(true),
      error: null,
      isLoading: false,
    });
    const { rerender } = renderPage(<ApiKeysPage />);
    expect(screen.getByText("No API keys yet")).toBeTruthy();

    market.resources.set("/api/account/api-keys", {
      data: null,
      error: new Error("failed"),
      isLoading: false,
    });
    rerender(<ApiKeysPage />);
    expect(screen.getByText(/API keys could not be loaded/i)).toBeTruthy();
  });

  it("shows exact ledger and conservative enforcement separately", () => {
    market.resources.set("/api/account/api-keys/key_1", {
      data: { key: detail },
      error: null,
      isLoading: false,
    });
    renderPage(<ApiKeyDetailPage id="key_1" />);

    expect(screen.getByRole("heading", { name: "Studio client" })).toBeTruthy();
    expect(screen.getByText("Recorded usage")).toBeTruthy();
    expect(screen.getByText("Exact Market ledger")).toBeTruthy();
    expect(screen.getByText("Ledger remaining")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Enforcement/i })).toBeTruthy();
    expect(screen.getByText(/Conservative provider-hidden guardrail state/i)).toBeTruthy();
    expect(screen.getByText(/new limit is below current rolling usage/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Activity" }).getAttribute("href")).toBe(
      "/account/activity?key=key_1",
    );
    expect(screen.getByRole("link", { name: "Logs" }).getAttribute("href")).toBe(
      "/account/logs?key=key_1",
    );
  });

  it("edits a finite key to unlimited without resetting history", async () => {
    const interaction = userEvent.setup();
    market.resources.set("/api/account/api-keys/key_1", {
      data: { key: detail },
      error: null,
      isLoading: false,
    });
    market.request.mockResolvedValue({ key: { ...detail, spendLimitUsd: null } });
    renderPage(<ApiKeyDetailPage id="key_1" />);

    await interaction.click(screen.getByRole("switch", { name: "Limit this key" }));
    await interaction.click(screen.getByRole("button", { name: "Save limit" }));

    expect(market.request).toHaveBeenCalledWith("/api/account/api-keys/key_1", {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: 3,
        limitUsd: null,
        windowDays: null,
      }),
    });
    await waitFor(() => expect(market.refresh).toHaveBeenCalledOnce());
    expect(
      await screen.findByText(/Existing usage was not reset/i),
    ).toBeTruthy();
  });

  it("renders pending revocation as immediate Market denial with safe retry", () => {
    market.resources.set("/api/account/api-keys/key_1", {
      data: { key: { ...detail, status: "revocation_pending" } },
      error: null,
      isLoading: false,
    });
    renderPage(<ApiKeyDetailPage id="key_1" />);

    expect(screen.getByText(/authorization is already blocked/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry revocation" })).toBeTruthy();
  });
});
