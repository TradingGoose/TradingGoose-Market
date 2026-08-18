// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  urls: [] as string[],
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/use-market-resource", () => ({
  useMarketResource: (url: string) => {
    market.urls.push(url);
    return { ...market.state, refresh: market.refresh };
  },
}));
vi.mock("recharts", () => {
  const Primitive = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    Area: Empty,
    AreaChart: Primitive,
    Bar: Empty,
    BarChart: Primitive,
    CartesianGrid: Empty,
    Legend: Empty,
    Line: Empty,
    LineChart: Primitive,
    ResponsiveContainer: Primitive,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

import { ActivityPage } from "../../components/account/activity/activity-page";
import { LogsPage } from "../../components/account/logs/logs-page";
import type { ActivityResponse, LogsResponse } from "../../lib/account/contracts";

afterEach(() => {
  cleanup();
  market.urls.length = 0;
  vi.clearAllMocks();
});

const facets = {
  keys: [{ id: "key_1", label: "Studio client" }],
  applications: [{ id: "https://studio.example/", label: "TradingGoose Studio" }],
  resources: [{ id: "market_hour", label: "Market Hours" }],
  endpoints: [{ id: "public.get.market-hours", label: "GET /api/get/market-hours" }],
};

const activity: ActivityResponse = {
  totalRequests: 12,
  completedSuccessCount: 10,
  completedErrorCount: 1,
  pendingCount: 1,
  activeKeyCount: 1,
  comparisonDeltaPercent: 20,
  buckets: [{ timestamp: "2026-07-18T00:00:00.000Z", requests: 12, successes: 10, errors: 1 }],
  topKeys: [{ id: "key_1", label: "Studio client", requests: 12 }],
  topApplications: [{ id: "https://studio.example/", label: "TradingGoose Studio", requests: 12 }],
  topResources: [{ id: "market_hour", label: "Market Hours", requests: 12 }],
  topEndpoints: [{ id: "public.get.market-hours", label: "GET /api/get/market-hours", requests: 12 }],
  series: [{ timestamp: "2026-07-18T00:00:00.000Z", seriesId: "market_hour", seriesLabel: "Market Hours", requests: 12, successes: 10, errors: 1 }],
  facets,
};

const logs: LogsResponse = {
  rows: [
    {
      id: "event_1",
      admittedAt: "2026-07-18T00:00:00.000Z",
      requestedResourceId: "market_hour",
      requestedResourceLabel: "Market Hours",
      routeId: "public.get.market-hours",
      category: "public.get.market-hours",
      method: "GET",
      version: "v1",
      keyId: "key_1",
      keyName: "Studio client",
      keyDisplayValue: "tg_pub_…4a2f",
      keyStatus: "revoked",
      applicationUrl: null,
      applicationTitle: null,
      completionStatus: "success",
      httpStatus: 200,
      completedAt: "2026-07-18T00:00:00.010Z",
    },
  ],
  histogram: [{ timestamp: "2026-07-18T00:00:00.000Z", requests: 1, successes: 1, errors: 0 }],
  nextCursor: "cursor_2",
  facets,
};

describe("OpenRouter-shaped Market Activity and Logs canvases", () => {
  it("renders operational request analytics with Market rankings and no spend semantics", () => {
    market.state = { data: activity, error: null, isLoading: false };
    render(<ActivityPage />);

    expect(screen.getByRole("heading", { name: "Activity" })).toBeTruthy();
    expect(
      screen.getAllByRole("tab").map((tab) => tab.textContent),
    ).toEqual(["Overview", "Trends", "Explore"]);
    expect(screen.getByText("Request admissions")).toBeTruthy();
    expect(screen.getByText("Completed successes")).toBeTruthy();
    expect(screen.getByText("Active keys")).toBeTruthy();
    expect(screen.getByText("Top Requested Resources")).toBeTruthy();
    expect(screen.getByText("Market Hours")).toBeTruthy();
    expect(screen.getByText("TradingGoose Studio")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/spent|invoice history|tokens|model provider/iu);
  });

  it("renders Market request occurrences, retained-key metadata, and cursor paging", async () => {
    const interaction = userEvent.setup();
    market.state = { data: logs, error: null, isLoading: false };
    render(<LogsPage />);

    expect(screen.getByRole("heading", { name: "Logs" })).toBeTruthy();
    for (const column of [
      "Date",
      "Requested",
      "Application",
      "Endpoint",
      "Method",
      "Status",
      "API Key",
      "Version",
      "Completed",
    ]) {
      expect(screen.getByRole("columnheader", { name: column })).toBeTruthy();
    }
    expect(screen.getByText("Market Hours")).toBeTruthy();
    expect(screen.getByText("market_hour")).toBeTruthy();
    expect(screen.getByText("Unattributed")).toBeTruthy();
    expect(screen.getAllByText("public.get.market-hours")).toHaveLength(2);
    expect(screen.getByText("Success 200")).toBeTruthy();
    expect(screen.getByText("1 request occurrences")).toBeTruthy();

    await interaction.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => {
      expect(market.urls.at(-1)).toContain("cursor=cursor_2");
    });
    expect(document.body.textContent).not.toMatch(/input tokens|output tokens|cost|AI model/iu);
  });

  it("renders explicit empty and error states", () => {
    market.state = {
      data: { ...activity, totalRequests: 0 },
      error: null,
      isLoading: false,
    };
    const { rerender } = render(<ActivityPage />);
    expect(screen.getByText("No activity in this period")).toBeTruthy();

    market.state = { data: null, error: new Error("failed"), isLoading: false };
    rerender(<ActivityPage />);
    expect(screen.getByText("Activity could not be loaded.")).toBeTruthy();
  });
});
