import { describe, expect, it } from "vitest";

import {
  MARKET_API_METHODS,
  MARKET_API_ROUTE_MANIFEST,
  resolveKeyedMarketRoute,
  resolveMarketRouteDescriptor,
} from "../../lib/market-api/core/manifest";
import { guardMarketRouteMethod } from "../../lib/market-api/core/method-guards";

describe("finite Market API authority", () => {
  it("gives every route one immutable access owner and one exact method set", () => {
    expect(Object.isFrozen(MARKET_API_ROUTE_MANIFEST)).toBe(true);
    expect(new Set(MARKET_API_ROUTE_MANIFEST.map((route) => route.path)).size).toBe(
      MARKET_API_ROUTE_MANIFEST.length,
    );

    for (const route of MARKET_API_ROUTE_MANIFEST) {
      expect(Object.isFrozen(route), route.path).toBe(true);
      expect(route.methods.length, route.path).toBeGreaterThan(0);
      expect(new Set(route.methods).size, route.path).toBe(route.methods.length);
      expect(route.keyed, route.path).toBe(route.access === "public-read" || route.access === "private-key");
      expect(route.billable, route.path).toBe(route.access === "public-read");
      if (!route.keyed) {
        expect(route.cors, route.path).toBeNull();
        expect(route.category, route.path).toBeNull();
        expect(route.resource, route.path).toBeNull();
      }
    }
  });

  it("partitions the keyed surface into 12 public reads and 6 private updates", () => {
    const keyed = MARKET_API_ROUTE_MANIFEST.filter((route) => route.keyed);
    const publicReads = keyed.filter((route) => route.access === "public-read");
    const privateUpdates = keyed.filter((route) => route.access === "private-key");

    expect(publicReads).toHaveLength(12);
    expect(privateUpdates).toHaveLength(6);
    expect(publicReads.every((route) => route.methods.join("|") === "GET|HEAD")).toBe(true);
    expect(privateUpdates.every((route) => route.methods.join("|") === "POST")).toBe(true);
    expect(publicReads.every((route) => route.cors === "public-read")).toBe(true);
    expect(privateUpdates.every((route) => route.cors === "private-key")).toBe(true);
  });

  it("rejects every unsupported method with the descriptor's exact Allow contract", async () => {
    for (const route of MARKET_API_ROUTE_MANIFEST) {
      for (const method of MARKET_API_METHODS) {
        const response = guardMarketRouteMethod(route, method);
        if (route.methods.includes(method)) {
          expect(response, `${route.path} ${method}`).toBeNull();
        } else {
          expect(response?.status, `${route.path} ${method}`).toBe(405);
          expect(response?.headers.get("allow"), `${route.path} ${method}`).toBe(
            route.methods.join(", "),
          );
          if (method === "HEAD") expect(await response!.text()).toBe("");
        }
      }
    }
  });

  it.each([
    "/api/get",
    "/api/update",
    "/api/search/unknown",
    "/api/get/market-hours/extra",
    "/api/update/crypto-rank/unknown",
    `/${"search"}/cities`,
    `/${"update"}/listing-rank`,
    "/api/account/api-usage",
    "/api/admin/settings",
  ])("does not resolve a legacy, alias, suffix, or unowned path: %s", (path) => {
    expect(resolveKeyedMarketRoute(path)).toBeNull();
    expect(resolveMarketRouteDescriptor(path)).toBeNull();
  });
});
