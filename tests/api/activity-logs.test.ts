import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => databaseState.current }));

import {
  advanceUsageCursorPagination,
  initialUsageCursorPagination,
  retreatUsageCursorPagination,
} from "../../lib/account/usage-pagination";
import { parseUsageFilters, UsageFilterInputError } from "../../lib/usage/http-filters";
import {
  buildUsageFacets,
  getCustomerActivity,
  getCustomerLogs,
} from "../../lib/usage/queries";

beforeEach(() => {
  databaseState.current = null;
});

describe("owner-safe Activity and Logs contracts", () => {
  it("accepts only bounded server-enumerated operational filters", () => {
    const parsed = parseUsageFilters(
      new URL(
        "https://market.example.com/api/account/activity?range=7d&key=key_1&app=https%3A%2F%2Fexample.com%2Fapp&route=public.get.market-hours&category=public.get.market-hours&resource=market_hour&completion=pending&granularity=hour&group=app&metric=requests",
      ),
      "activity",
    );
    expect(parsed).toEqual({
      range: "7d",
      keyId: "key_1",
      appUrl: "https://example.com/app",
      routeId: "public.get.market-hours",
      category: "public.get.market-hours",
      resourceId: "market_hour",
      completion: "pending",
      granularity: "hour",
      group: "app",
      metric: "requests",
    });

    for (const query of [
      "metric=spent",
      "sort=cost",
      "range=365d",
      "route=unknown.route",
      "resource=model",
      "limit=101",
      "cursor=not-a-cursor",
    ]) {
      const mode = query.startsWith("limit") || query.startsWith("cursor") ? "logs" : "activity";
      expect(() =>
        parseUsageFilters(new URL(`https://market.example.com/api/account/logs?${query}`), mode),
      ).toThrow(UsageFilterInputError);
    }
  });

  it("keeps stable cursor history and resets cleanly to the first page", () => {
    let state = initialUsageCursorPagination();
    state = advanceUsageCursorPagination(state, "cursor_2");
    state = advanceUsageCursorPagination(state, "cursor_3");
    expect(state).toEqual({ cursor: "cursor_3", history: ["", "cursor_2"] });
    state = retreatUsageCursorPagination(state);
    expect(state).toEqual({ cursor: "cursor_2", history: [""] });
    state = retreatUsageCursorPagination(state);
    expect(state).toEqual({ cursor: null, history: [] });
  });

  it("projects retained revoked-key history, pending completions, attribution, and an opaque cursor", async () => {
    databaseState.current = logsDatabase();

    const result = await getCustomerLogs("customer_1", { range: "30d", limit: 2 });

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      id: "event_3",
      requestedResourceId: "market_hour",
      requestedResourceLabel: "Market Hours",
      routeId: "public.get.market-hours",
      keyId: "key_revoked",
      keyStatus: "revoked",
      applicationUrl: "https://example.com/app",
      applicationTitle: "Portfolio",
      completionStatus: "success",
      httpStatus: 200,
    });
    expect(result.rows[1]).toMatchObject({
      id: "event_2",
      requestedResourceId: "listing_identity",
      requestedResourceLabel: "Listing Identity",
      keyStatus: "revocation_pending",
      completionStatus: "pending",
      httpStatus: null,
    });
    expect(result.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() =>
      parseUsageFilters(
        new URL(`https://market.example.com/api/account/logs?cursor=${result.nextCursor}`),
        "logs",
      ),
    ).not.toThrow();
    expect(result.facets.keys).toContainEqual({ id: "key_revoked", label: "Retained key" });
    expect(result.facets.applications).toContainEqual({
      id: "https://example.com/app",
      label: "Latest App Title",
    });
    expect(JSON.stringify(result)).not.toMatch(/billableCost|spent|stripe|providerId|rawKey/i);
  });

  it("groups a canonical application URL by its latest title while retaining Unattributed", () => {
    const facets = buildUsageFacets({
      keys: [{ id: "key_1", name: "Client", displayValue: "tg_pub…0001" }],
      applications: [
        { url: "https://example.com/app", title: "Newest title" },
        { url: null, title: null },
      ],
      resources: [{ id: "country" }, { id: "exchange" }],
      endpoints: [{ id: "public.search.countries" }, { id: "public.search.exchanges" }],
    });
    expect(facets.applications).toEqual([
      { id: "https://example.com/app", label: "Newest title" },
      { id: "Unattributed", label: "Unattributed" },
    ]);
  });

  it("selects bounded Explore series by the requested metric rather than Overview requests", async () => {
    const database = activityDatabase();
    databaseState.current = database;

    const result = await getCustomerActivity("customer_1", {
      range: "30d",
      group: "app",
      metric: "errors",
    });

    expect(result.topApplications.map((row) => row.id)).not.toContain(
      "https://errors.example/app",
    );
    expect(result.series).toContainEqual(expect.objectContaining({
      seriesId: "https://errors.example/app",
      seriesLabel: "Error Winner",
      errors: 12,
    }));
    expect(database.metricSelections()).toBe(1);
  });
});

function activityDatabase() {
  let idOnlySelections = 0;
  let metricSelections = 0;
  const requestApplications = Array.from({ length: 10 }, (_, index) => ({
    url: `https://requests-${index}.example/app`,
    title: `Requests ${index}`,
    requests: 100 - index,
  }));
  const rowsFor = (selection: Record<string, unknown>) => {
    const keys = Object.keys(selection);
    if (keys.includes("metric")) {
      metricSelections += 1;
      return [
        {
          id: "https://errors.example/app",
          url: "https://errors.example/app",
          title: "Error Winner",
          metric: 12,
        },
        { id: "__unattributed__", url: null, title: null, metric: 3 },
      ];
    }
    if (keys.includes("seriesId")) {
      return [{
        timestamp: "2026-07-20T00:00:00Z",
        seriesId: "https://errors.example/app",
        requests: 13,
        successes: 1,
        errors: 12,
      }];
    }
    if (keys.includes("activeKeys")) {
      return [{ total: 20, activeKeys: 11, successes: 8, errors: 12, pending: 0 }];
    }
    if (keys.length === 1 && keys[0] === "total") return [{ total: 10 }];
    if (keys.includes("timestamp")) {
      return [{ timestamp: "2026-07-20T00:00:00Z", requests: 20, successes: 8, errors: 12 }];
    }
    if (keys.includes("displayValue")) {
      if (keys.includes("requests")) {
        return Array.from({ length: 10 }, (_, index) => ({
          id: `key_${index}`,
          name: `Key ${index}`,
          displayValue: `tg_pub_${index}`,
          requests: 100 - index,
        }));
      }
      return Array.from({ length: 11 }, (_, index) => ({
        id: `key_${index}`,
        name: `Key ${index}`,
        displayValue: `tg_pub_${index}`,
      }));
    }
    if (keys.includes("url")) {
      if (keys.includes("requests")) return requestApplications;
      return [
        ...requestApplications.map(({ url, title }) => ({ url, title })),
        { url: "https://errors.example/app", title: "Error Winner" },
        { url: null, title: null },
      ];
    }
    if (keys.length === 1 && keys[0] === "id") {
      idOnlySelections += 1;
      return idOnlySelections % 2 === 1
        ? [{ id: "country" }]
        : [{ id: "public.search.countries" }];
    }
    if (keys.includes("requests") && keys.includes("id")) {
      return [{ id: "country", requests: 20 }];
    }
    return [];
  };
  return {
    metricSelections: () => metricSelections,
    select(selection: Record<string, unknown>) {
      const builder = {
        from() { return builder; },
        innerJoin() { return builder; },
        leftJoin() { return builder; },
        where() { return builder; },
        groupBy() { return builder; },
        orderBy() { return builder; },
        limit() { return builder; },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(rowsFor(selection)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function logsDatabase() {
  let singleIdSelect = 0;
  const rowsFor = (selection: Record<string, unknown>) => {
    const keys = Object.keys(selection);
    if (keys.includes("displayValue")) {
      return [{ id: "key_revoked", name: "Retained key", displayValue: "tg_pub…0001" }];
    }
    if (keys.includes("url")) {
      return [
        { url: "https://example.com/app", title: "Latest App Title" },
        { url: null, title: null },
      ];
    }
    if (keys.length === 1 && keys[0] === "id") {
      singleIdSelect += 1;
      return singleIdSelect === 1
        ? [{ id: "market_hour" }, { id: "listing_identity" }]
        : [{ id: "public.get.market-hours" }, { id: "public.get.listing" }];
    }
    if (keys.includes("timestamp") && !keys.includes("admittedAt")) {
      return [{ timestamp: "2026-07-19T00:00:00Z", requests: 3, successes: 1, errors: 1 }];
    }
    if (keys.includes("admittedAt")) {
      return [
        {
          id: "event_3",
          admittedAt: new Date("2026-07-19T03:00:00.000Z"),
          resourceId: "market_hour",
          routeId: "public.get.market-hours",
          category: "public.get.market-hours",
          method: "GET",
          version: "v1",
          applicationUrl: "https://example.com/app",
          applicationTitle: "Portfolio",
          keyId: "key_revoked",
          keyName: "Retained key",
          keyDisplay: "tg_pub…0001",
          keyRevocationRequestedAt: new Date("2026-07-19T04:00:00.000Z"),
          keyProviderRevokedAt: new Date("2026-07-19T04:01:00.000Z"),
          resultClass: "success",
          httpStatus: 200,
          completedAt: new Date("2026-07-19T03:00:01.000Z"),
        },
        {
          id: "event_2",
          admittedAt: new Date("2026-07-19T02:00:00.000Z"),
          resourceId: "listing_identity",
          routeId: "public.get.listing",
          category: "public.get.listing",
          method: "HEAD",
          version: "v1",
          applicationUrl: null,
          applicationTitle: null,
          keyId: "key_pending",
          keyName: "Pending key",
          keyDisplay: "tg_pub…0002",
          keyRevocationRequestedAt: new Date("2026-07-19T02:30:00.000Z"),
          keyProviderRevokedAt: null,
          resultClass: null,
          httpStatus: null,
          completedAt: null,
        },
        {
          id: "event_1",
          admittedAt: new Date("2026-07-19T01:00:00.000Z"),
          resourceId: "country",
          routeId: "public.search.countries",
          category: "public.search.countries",
          method: "GET",
          version: "v1",
          applicationUrl: null,
          applicationTitle: null,
          keyId: "key_available",
          keyName: "Available key",
          keyDisplay: "tg_pub…0003",
          keyRevocationRequestedAt: null,
          keyProviderRevokedAt: null,
          resultClass: "client_error",
          httpStatus: 400,
          completedAt: new Date("2026-07-19T01:00:01.000Z"),
        },
      ];
    }
    return [];
  };

  return {
    select(selection: Record<string, unknown>) {
      const builder = {
        from() { return builder; },
        innerJoin() { return builder; },
        leftJoin() { return builder; },
        where() { return builder; },
        groupBy() { return builder; },
        orderBy() { return builder; },
        limit() { return builder; },
        then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(rowsFor(selection)).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
