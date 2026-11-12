import { describe, expect, it } from "vitest";
import { buildLogsQuery } from "./usage-query";

const filters = {
  range: "24h",
  keyId: "key-retained",
  appUrl: "https://studio.example/market",
  resourceId: "market_hour",
  routeId: "private.update.market-hours",
  completion: "success",
};

describe("usage browser query contracts", () => {
  it.each(["account", "admin"] as const)("keeps %s pagination inside the logs contract", (scope) => {
    const params = new URLSearchParams(
      buildLogsQuery(scope, { ...filters, cursor: "next-cursor" }),
    );

    expect(Object.fromEntries(params)).toEqual({
      range: "24h",
      limit: "50",
      ...(scope === "admin" ? { view: "logs" } : {}),
      cursor: "next-cursor",
      key: "key-retained",
      app: "https://studio.example/market",
      resource: "market_hour",
      route: "private.update.market-hours",
      completion: "success",
    });
    expect(params.has("granularity")).toBe(false);
    expect(params.has("metric")).toBe(false);
    expect(params.has("group")).toBe(false);
  });

  it("omits absent filters and cursors", () => {
    expect(buildLogsQuery("account", {
      range: "7d", keyId: "all", appUrl: "all", resourceId: "all",
      routeId: "all", completion: "all", cursor: null,
    })).toBe("range=7d&limit=50");
  });
});
