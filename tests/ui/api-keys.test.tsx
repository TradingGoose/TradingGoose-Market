// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  resources: new Map<string, Record<string, unknown>>(),
  resourceUrls: [] as string[],
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
    useMarketResource: (url: string) => {
      market.resourceUrls.push(url);
      return {
        ...(market.resources.get(url) ?? { data: null, error: null, isLoading: false }),
        refresh: market.refresh,
      };
    },
    marketApiRequest: market.request,
  };
});

import { ApiKeyDetailPage } from "../../components/account/api-keys/api-key-detail-page";
import { ApiKeysPage } from "../../components/api-access/api-keys-page";
import AccountKeysPage from "../../app/account/api-keys/page";
import AdminKeysPage from "../../app/admin/api-keys/page";
import { TooltipProvider } from "../../components/ui/tooltip";
import type { AdminApiKeySummary, MarketApiKeyDetail, MarketApiKeySummary } from "../../lib/account/contracts";

afterEach(() => {
  cleanup();
  market.resources.clear();
  market.resourceUrls.length = 0;
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

const privateSummary: AdminApiKeySummary = {
  id: "private_1",
  name: "Market updater",
  displayValue: "tg_priv_…4a2f",
  status: "available",
  createdAt: "2026-07-01T00:00:00.000Z",
  lastUsedAt: "2026-07-18T00:00:00.000Z",
  totalRequestCount: 1250,
  originatingAdminName: "Grace Hopper",
  originatingAdminEmail: "grace@example.com",
  grantStatus: "removed",
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
    billingBlocked: false,
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
  it("explains payment-paused access without blocking customer key management", async () => {
    const interaction = userEvent.setup();
    market.resources.set("/api/account/api-keys", { data: { keys: [summary] }, error: null, isLoading: false });
    market.resources.set("/api/account/billing", { data: { ...billing(true), billingBlocked: true }, error: null, isLoading: false });
    renderPage(<AccountKeysPage />);
    expect(screen.getByText(/API access is paused because a usage payment failed/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Studio client" })).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "New Key" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create key" })).toBeTruthy();
  });
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
    renderPage(<ApiKeysPage scope="account" />);

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
    const { rerender } = renderPage(<ApiKeysPage scope="account" />);
    expect(screen.getByText("No API keys yet")).toBeTruthy();

    market.resources.set("/api/account/api-keys", {
      data: null,
      error: new Error("failed"),
      isLoading: false,
    });
    rerender(<ApiKeysPage scope="account" />);
    expect(screen.getByText(/API keys could not be loaded/i)).toBeTruthy();
  });

  it("uses the shared searchable private-key table without customer billing or detail access", async () => {
    const interaction = userEvent.setup();
    market.resources.set("/api/admin/api-keys", { data: { keys: [privateSummary] }, error: null, isLoading: false });
    renderPage(<AdminKeysPage />);

    expect(new Set(market.resourceUrls)).toEqual(new Set(["/api/admin/api-keys"]));
    expect(screen.getByRole("heading", { name: "API Keys" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Originating admin" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Grant" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Created" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Usage" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Limit" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Window" })).toBeNull();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByText("grace@example.com")).toBeTruthy();
    expect(screen.getByText("removed")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Market updater" })).toBeNull();

    await interaction.type(screen.getByPlaceholderText("Search API keys"), "missing");
    expect(screen.getByText("No matching keys")).toBeTruthy();
    expect(screen.getByText("0 of 1 keys")).toBeTruthy();
    await interaction.clear(screen.getByPlaceholderText("Search API keys"));
    await interaction.click(screen.getByRole("button", { name: "Actions for Market updater" }));
    expect(screen.getByRole("menuitem", { name: "Activity" }).getAttribute("href")).toBe("/admin/activity?key=private_1");
    expect(screen.getByRole("menuitem", { name: "Logs" }).getAttribute("href")).toBe("/admin/logs?key=private_1");
    expect(screen.queryByRole("menuitem", { name: "View details" })).toBeNull();
  });

  it("creates a private key with only its name and reveals the secret once", async () => {
    const interaction = userEvent.setup();
    market.resources.set("/api/admin/api-keys", { data: { keys: [privateSummary] }, error: null, isLoading: false });
    market.request.mockResolvedValue({ key: privateSummary, secret: "test-private-secret" });
    renderPage(<ApiKeysPage scope="admin" />);

    await interaction.click(screen.getByRole("button", { name: "New Key" }));
    expect(screen.getByRole("dialog", { name: "New private API key" })).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByLabelText("Spend limit (whole USD)")).toBeNull();
    expect(screen.queryByLabelText("Rolling window (days)")).toBeNull();
    await interaction.type(screen.getByLabelText("Name"), "  Market updater  ");
    await interaction.click(screen.getByRole("button", { name: "Create key" }));

    expect(market.request).toHaveBeenCalledWith("/api/admin/api-keys", { method: "POST", body: JSON.stringify({ name: "Market updater" }) });
    expect(await screen.findByRole("dialog", { name: "Copy Market updater now" })).toBeTruthy();
    expect(screen.getByText("test-private-secret")).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "Copy secret" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    await interaction.click(screen.getByRole("button", { name: "I saved it" }));
    expect(screen.queryByText("test-private-secret")).toBeNull();
    expect(new Set(market.resourceUrls)).toEqual(new Set(["/api/admin/api-keys"]));
  });

  it("preserves whole-dollar and 1–30-day customer creation limits", async () => {
    const interaction = userEvent.setup();
    market.resources.set("/api/account/api-keys", { data: { keys: [summary] }, error: null, isLoading: false });
    market.request.mockResolvedValue({ key: summary, secret: "test-public-secret" });
    renderPage(<ApiKeysPage scope="account" />);

    await interaction.click(screen.getByRole("button", { name: "New Key" }));
    await interaction.type(screen.getByLabelText("Name"), "Studio client");
    await interaction.click(screen.getByRole("switch", { name: "Spend limit" }));
    await interaction.type(screen.getByLabelText("Spend limit (whole USD)"), "5");
    await interaction.type(screen.getByLabelText("Rolling window (days)"), "31");
    await interaction.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByText("Rolling window must be from 1 through 30 days.")).toBeTruthy();
    expect(market.request).not.toHaveBeenCalled();
    await interaction.clear(screen.getByLabelText("Rolling window (days)"));
    await interaction.type(screen.getByLabelText("Rolling window (days)"), "30");
    await interaction.click(screen.getByRole("button", { name: "Create key" }));

    expect(market.request).toHaveBeenCalledWith("/api/account/api-keys", { method: "POST", body: JSON.stringify({ name: "Studio client", limitUsd: "5", windowDays: 30 }) });
    expect(await screen.findByText("test-public-secret")).toBeTruthy();
  });

  it.each(["account", "admin"] as const)("keeps %s revocation on its own endpoint and supports pending-provider retry", async (scope) => {
    const interaction = userEvent.setup();
    const key = { ...(scope === "admin" ? privateSummary : summary), id: "key/with space", status: "revocation_pending" };
    const endpoint = `/api/${scope}/api-keys`;
    market.resources.set(endpoint, { data: { keys: [key] }, error: null, isLoading: false });
    market.request.mockResolvedValue({ status: "revocation_pending", retryable: true });
    renderPage(<ApiKeysPage scope={scope} />);

    await interaction.click(screen.getByRole("button", { name: `Actions for ${key.name}` }));
    await interaction.click(screen.getByRole("menuitem", { name: "Retry revocation" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("retaining its usage history");
    await interaction.click(within(dialog).getByRole("button", { name: "Retry revocation" }));
    expect(market.request).toHaveBeenCalledWith(`${endpoint}/key%2Fwith%20space`, { method: "DELETE" });
    expect(await screen.findByText(/Provider confirmation is pending/)).toBeTruthy();
    expect(market.refresh).toHaveBeenCalledOnce();
  });

  it("provides the shared private-key empty/error recovery states", async () => {
    const interaction = userEvent.setup();
    market.resources.set("/api/admin/api-keys", { data: { keys: [] }, error: null, isLoading: false });
    const view = renderPage(<ApiKeysPage scope="admin" />);
    expect(screen.getByText("Create a private key for Market update endpoints.")).toBeTruthy();
    market.resources.set("/api/admin/api-keys", { data: null, error: "unavailable", isLoading: false });
    view.rerender(<ApiKeysPage scope="admin" />);
    await interaction.click(screen.getByRole("button", { name: "Retry" }));
    expect(market.refresh).toHaveBeenCalledOnce();
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
