import { describe, expect, it } from "vitest";
import { buildAdminUsageQuery, buildCustomerLogsQuery } from "./usage-query";

const filters = {
  range: "24h",
  keyId: "key-retained",
  appUrl: "https://studio.example/market",
  resourceId: "market_hour",
  routeId: "public.get.market-hours",
  completion: "success",
};

describe("usage browser query contracts", () => {
  it("sends only activity parameters for the admin activity view", () => {
    const params = new URLSearchParams(
      buildAdminUsageQuery({ ...filters, view: "activity", cursor: "old-cursor" }),
    );

    expect(Object.fromEntries(params)).toEqual({
      view: "activity",
      range: "24h",
      granularity: "hour",
      key: "key-retained",
      app: "https://studio.example/market",
      resource: "market_hour",
      route: "public.get.market-hours",
      completion: "success",
    });
    expect(params.has("limit")).toBe(false);
    expect(params.has("cursor")).toBe(false);
  });

  it("sends only log parameters for the admin logs view", () => {
    const params = new URLSearchParams(
      buildAdminUsageQuery({ ...filters, view: "logs", cursor: "next-cursor" }),
    );

    expect(params.get("view")).toBe("logs");
    expect(params.get("limit")).toBe("50");
    expect(params.get("cursor")).toBe("next-cursor");
    expect(params.has("granularity")).toBe(false);
  });

  it("keeps the customer logs cursor inside the log-only contract", () => {
    const params = new URLSearchParams(
      buildCustomerLogsQuery({ ...filters, cursor: "next-cursor" }),
    );

    expect(params.get("limit")).toBe("50");
    expect(params.get("cursor")).toBe("next-cursor");
    expect(params.has("view")).toBe(false);
    expect(params.has("granularity")).toBe(false);
  });
});
