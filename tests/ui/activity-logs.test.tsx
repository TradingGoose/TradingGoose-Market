// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const market = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  urls: [] as string[],
  refresh: vi.fn(),
  charts: [] as Array<Array<Record<string, string | number>>>,
  resolve: null as ((url: string) => Record<string, unknown>) | null,
  search: "",
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(market.search),
}));
vi.mock("@/hooks/use-market-resource", () => ({
  useMarketResource: (url: string) => {
    market.urls.push(url);
    const state = market.resolve?.(url) ?? market.state;
    return {
      ...state,
      data: url.startsWith("/api/admin/") && state.data
        ? { view: new URL(url, "https://market.example").searchParams.get("view"), data: state.data }
        : state.data,
      refresh: market.refresh,
    };
  },
}));
vi.mock("recharts", () => {
  const Primitive = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  const Chart = ({ children, data }: { children?: React.ReactNode; data: Array<Record<string, string | number>> }) => {
    market.charts.push(data);
    return <div>{children}</div>;
  };
  return {
    Area: Empty,
    AreaChart: ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>,
    Bar: Empty,
    BarChart: Chart,
    CartesianGrid: Empty,
    Legend: Empty,
    Line: Empty,
    LineChart: Chart,
    ResponsiveContainer: Primitive,
    Tooltip: Empty,
    XAxis: Empty,
    YAxis: Empty,
  };
});

import { ActivityPage } from "../../components/api-access/activity-page";
import { LogsPage } from "../../components/api-access/logs-page";
import AccountActivityPage from "../../app/account/activity/page";
import AccountLogsPage from "../../app/account/logs/page";
import AdminActivityPage from "../../app/admin/activity/page";
import AdminLogsPage from "../../app/admin/logs/page";
import type { ActivityResponse, LogsResponse } from "../../lib/account/contracts";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  market.urls.length = 0;
  market.charts.length = 0;
  market.resolve = null;
  market.search = "";
  vi.clearAllMocks();
});

const facets = {
  keys: [{ id: "key_1", label: "Studio client" }, { id: "key_2", label: "Updater client" }],
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

describe.each(["account", "admin"] as const)("Shared Market %s Activity and Logs canvases", (scope) => {
  const ActivityRoute = scope === "admin" ? AdminActivityPage : AccountActivityPage;
  const LogsRoute = scope === "admin" ? AdminLogsPage : AccountLogsPage;
  it("renders operational request analytics with Market rankings and no spend semantics", () => {
    market.state = { data: activity, error: null, isLoading: false };
    render(<ActivityRoute />);

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
    const url = new URL(market.urls.at(-1)!, "https://market.example");
    expect(url.pathname).toBe(scope === "admin" ? "/api/admin/api-usage" : "/api/account/activity");
    expect(url.searchParams.get("view")).toBe(scope === "admin" ? "activity" : null);
    expect(url.searchParams.get("granularity")).toBe("day");
    expect(url.searchParams.get("metric")).toBe("requests");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("cursor")).toBe(false);
    if (scope === "admin") expect(screen.getByText(/System-wide private admin-key admissions/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/spent|invoice history|tokens|model provider/iu);
  });

  it("renders Market request occurrences, retained-key metadata, and cursor paging", async () => {
    const interaction = userEvent.setup();
    market.state = { data: logs, error: null, isLoading: false };
    render(<LogsRoute />);

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
    const url = new URL(market.urls.at(-1)!, "https://market.example");
    expect(url.pathname).toBe(scope === "admin" ? "/api/admin/api-usage" : "/api/account/logs");
    expect(url.searchParams.get("view")).toBe(scope === "admin" ? "logs" : null);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.has("granularity")).toBe(false);
    if (scope === "admin") expect(screen.getByText(/System-wide private admin-key request history/)).toBeTruthy();

    await interaction.click(screen.getByRole("button", { name: /Next/i }));
    await waitFor(() => {
      expect(market.urls.at(-1)).toContain("cursor=cursor_2");
    });
    await interaction.click(screen.getByRole("button", { name: /Previous/i }));
    expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.has("cursor")).toBe(false);
    expect(document.body.textContent).not.toMatch(/input tokens|output tokens|cost|AI model/iu);
  });

  it.each(["Trends", "Explore"])("preserves %s selection across data reloads", async (tab) => {
    const interaction = userEvent.setup();
    market.state = { data: activity, error: null, isLoading: false };
    const { rerender } = render(<ActivityPage scope={scope} />);
    await interaction.click(screen.getByRole("tab", { name: tab }));
    expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
    await interaction.click(screen.getByRole("button", { name: "Refresh" }));
    expect(market.refresh).toHaveBeenCalledOnce();

    // Loading, errors and empty results all unmount Tabs, but must not reset
    // the page-owned selection when the next filter/metric result arrives.
    for (const state of [
      { data: activity, error: null, isLoading: true },
      { data: null, error: new Error("failed"), isLoading: false },
      { data: { ...activity, totalRequests: 0 }, error: null, isLoading: false },
    ]) {
      market.state = state;
      rerender(<ActivityPage scope={scope} />);
      expect(screen.queryByRole("tab", { name: tab })).toBeNull();
      market.state = { data: activity, error: null, isLoading: false };
      rerender(<ActivityPage scope={scope} />);
      expect(screen.getByRole("tab", { name: tab }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("false");
    }
  });

  it.each(["Trends", "Explore"])("passes explicit zero-traffic periods and values to the %s chart", async (tab) => {
    const interaction = userEvent.setup();
    const timestamps = ["2026-07-20T00:00:00Z", "2026-07-21T00:00:00Z", "2026-07-22T00:00:00Z"];
    const buckets = timestamps.map((timestamp, index) => ({
      timestamp, requests: index === 1 ? 0 : 10, successes: 0, errors: 0,
    }));
    const series = timestamps.flatMap((timestamp, index) => [
      { timestamp, seriesId: "country", seriesLabel: "Country", requests: index === 0 ? 10 : 0, successes: 0, errors: 0 },
      { timestamp, seriesId: "exchange", seriesLabel: "Exchange", requests: index === 2 ? 10 : 0, successes: 0, errors: 0 },
    ]);
    market.state = { data: { ...activity, totalRequests: 20, buckets, series }, error: null, isLoading: false };
    render(<ActivityPage scope={scope} />);
    market.charts.length = 0;
    await interaction.click(screen.getByRole("tab", { name: tab }));
    const seriesChart = market.charts.find((points) => points.some((point) => Object.hasOwn(point, "series0")));
    expect(seriesChart).toEqual([
      { timestamp: timestamps[0], series0: 10, series1: 0 },
      { timestamp: timestamps[1], series0: 0, series1: 0 },
      { timestamp: timestamps[2], series0: 0, series1: 10 },
    ]);
  });

  it("ranks Trends by requests without discarding Explore's selected metric", async () => {
    const interaction = userEvent.setup();
    const timestamp = "2026-07-20T00:00:00Z";
    market.resolve = (url) => {
      const metric = new URL(url, "https://market.example").searchParams.get("metric");
      const series = metric === "errors"
        ? Array.from({ length: 8 }, (_, index) => ({
          timestamp, seriesId: `error-app-${index}`, seriesLabel: `Error app ${index}`,
          requests: 2, successes: 0, errors: 2,
        }))
        : [{ timestamp, seriesId: "busy-app", seriesLabel: "Busy app", requests: 1000, successes: 1000, errors: 0 }];
      return { data: { ...activity, series }, error: null, isLoading: false };
    };
    render(<ActivityPage scope={scope} />);
    await interaction.click(screen.getByRole("tab", { name: "Explore" }));
    const metricSelect = screen.getAllByRole("combobox").find((control) => control.textContent === "Requests");
    expect(metricSelect).toBeTruthy();
    metricSelect!.focus();
    await interaction.keyboard("{ArrowDown}{End}{Enter}");
    expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.get("metric")).toBe("errors");
    expect(screen.getByText("Error app 0")).toBeTruthy();

    market.charts.length = 0;
    await interaction.click(screen.getByRole("tab", { name: "Trends" }));
    expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.get("metric")).toBe("requests");
    expect(market.charts.filter((points) => points.some((point) => Object.hasOwn(point, "series0"))).at(-1))
      .toEqual([{ timestamp, series0: 1000 }]);

    await interaction.click(screen.getByRole("tab", { name: "Explore" }));
    expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.get("metric")).toBe("errors");
    expect(screen.getByText("Errors by application")).toBeTruthy();
    expect(screen.getByText("Error app 0")).toBeTruthy();
  });

  it("renders explicit empty and error states", () => {
    market.state = {
      data: { ...activity, totalRequests: 0 },
      error: null,
      isLoading: false,
    };
    const { rerender } = render(<ActivityPage scope={scope} />);
    expect(screen.getByText("No activity in this period")).toBeTruthy();
    expect(screen.getByText(scope === "admin"
      ? /Admitted private admin-key update requests/
      : /Admitted customer-key requests/)).toBeTruthy();

    market.state = { data: null, error: new Error("failed"), isLoading: false };
    rerender(<ActivityPage scope={scope} />);
    expect(screen.getByText("Activity could not be loaded.")).toBeTruthy();
  });

  it.each(["activity", "logs"] as const)("updates %s key filters on URL navigation without resetting unrelated state", async (page) => {
    const interaction = userEvent.setup();
    const Page = page === "activity" ? ActivityPage : LogsPage;
    market.search = "key=key_1";
    market.state = { data: page === "activity" ? activity : logs, error: null, isLoading: false };
    const { rerender } = render(<Page scope={scope} />);
    expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.get("key")).toBe("key_1");
    screen.getAllByRole("combobox")[0].focus();
    await interaction.keyboard("{ArrowDown}{End}{Enter}");
    if (page === "activity") await interaction.click(screen.getByRole("tab", { name: "Trends" }));

    for (const key of ["key_2", null, "key_1"]) {
      if (page === "logs") {
        await interaction.click(screen.getByRole("button", { name: /Next/i }));
        expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.get("cursor")).toBe("cursor_2");
      }
      const beforeNavigation = market.urls.length;
      market.search = key ? `key=${key}` : "";
      rerender(<Page scope={scope} />);
      const params = new URL(market.urls.at(-1)!, "https://market.example").searchParams;
      expect(params.get("key")).toBe(key);
      expect(params.get("range")).toBe("90d");
      expect(screen.getAllByRole("combobox")[1].textContent).toContain(key === "key_1" ? "Studio client" : key === "key_2" ? "Updater client" : "All");
      if (page === "activity") {
        expect(screen.getByRole("tab", { name: "Trends" }).getAttribute("aria-selected")).toBe("true");
      } else {
        expect(params.has("cursor")).toBe(false);
        expect((screen.getByRole("button", { name: /Previous/i }) as HTMLButtonElement).disabled).toBe(true);
        const newKeyRequests = market.urls.slice(beforeNavigation).map((url) => new URL(url, "https://market.example").searchParams).filter((query) => query.get("key") === key);
        expect(newKeyRequests.every((query) => !query.has("cursor"))).toBe(true);
      }
    }
  });

  it.each(["activity", "logs"] as const)("preserves local %s key selection when the incoming URL key is unchanged", async (page) => {
    const interaction = userEvent.setup();
    const Page = page === "activity" ? ActivityPage : LogsPage;
    market.state = { data: page === "activity" ? activity : logs, error: null, isLoading: false };
    const { rerender } = render(<Page scope={scope} />);
    screen.getAllByRole("combobox")[1].focus();
    await interaction.keyboard("{ArrowDown}{End}{Enter}");
    for (const search of ["", "unrelated=value"]) {
      market.search = search;
      rerender(<Page scope={scope} />);
      expect(new URL(market.urls.at(-1)!, "https://market.example").searchParams.get("key")).toBe("key_2");
      expect(screen.getAllByRole("combobox")[1].textContent).toContain("Updater client");
    }
  });
});
