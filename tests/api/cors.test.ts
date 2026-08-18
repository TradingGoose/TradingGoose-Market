import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { handleMarketPreflight } from "../../lib/market-api/core/cors";
import { MARKET_API_ROUTE_MANIFEST } from "../../lib/market-api/core/manifest";
import {
  createMarketPreflightHandler,
  createMarketRejectedMethodHandler,
  createMarketRouteHandler,
} from "../../lib/market-api/core/route-handler";
import { clearMarketRuntimeConfigCacheForTests } from "../../lib/environment";

const environment = {
  DATABASE_URL: "postgres://market:market@localhost:5432/market_test",
  NEXT_PUBLIC_APP_URL: "https://market.example.com",
  BETTER_AUTH_URL: "https://market.example.com",
  BETTER_AUTH_SECRET: "test-secret",
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
  REGISTRATION_MODE: "open",
  BILLING_ENABLED: "false",
  PAYG_USD_PER_1000_READS: "1",
  UNKEY_API_ID: "api_market",
  UNKEY_KEY_MANAGEMENT_ROOT_KEY: "management-root",
  UNKEY_KEY_VERIFY_ROOT_KEY: "verify-root",
} as const;
const original = new Map<string, string | undefined>();

function expectCanonicalCors(response: Response) {
  expect(response.headers.get("access-control-allow-origin")).toBe(
    "https://market.example.com",
  );
  expect(
    response.headers
      .get("vary")
      ?.split(",")
      .map((value) => value.trim().toLowerCase()),
  ).toContain("origin");
}

beforeAll(() => {
  for (const [key, value] of Object.entries(environment)) {
    original.set(key, process.env[key]);
    process.env[key] = value;
  }
  clearMarketRuntimeConfigCacheForTests();
});

afterAll(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearMarketRuntimeConfigCacheForTests();
});

describe("descriptor-owned CORS", () => {
  it("serves preflight only for every exact keyed route without provider work", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const keyed = MARKET_API_ROUTE_MANIFEST.filter((route) => route.keyed);

    for (const route of keyed) {
      const requestedMethod = route.methods[0];
      const response = handleMarketPreflight(
        new Request(`https://market.example.com${route.path}?version=v1`, {
          method: "OPTIONS",
          headers: {
            origin: "https://market.example.com",
            "access-control-request-method": requestedMethod,
            "access-control-request-headers":
              route.access === "private-key"
                ? "content-type, x-api-key, http-referer, x-title"
                : "x-api-key, http-referer, x-title",
          },
        }),
        route,
      );

      expect(response.status, route.path).toBe(204);
      expect(response.headers.get("access-control-allow-origin"), route.path).toBe(
        "https://market.example.com",
      );
      expect(response.headers.get("access-control-allow-methods"), route.path).toBe(
        `${route.methods.join(", ")}, OPTIONS`,
      );
      expect(response.headers.get("access-control-allow-headers"), route.path).toBe(
        route.access === "private-key"
          ? "x-api-key, http-referer, x-title, content-type"
          : "x-api-key, http-referer, x-title",
      );
    }

    expect(keyed).toHaveLength(18);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    { origin: "https://other.example.com", method: "GET", headers: "x-api-key", status: 403 },
    { origin: "https://market.example.com", method: "POST", headers: "x-api-key", status: 405 },
    { origin: "https://market.example.com", method: "GET", headers: "authorization", status: 400 },
  ])("fails closed for a noncanonical request: %#", ({ origin, method, headers, status }) => {
    const route = MARKET_API_ROUTE_MANIFEST.find(
      (candidate) => candidate.keyed && candidate.path === "/api/search/cities",
    );
    expect(route?.keyed).toBe(true);
    const response = handleMarketPreflight(
      new Request("https://market.example.com/api/search/cities?version=v1", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": method,
          "access-control-request-headers": headers,
        },
      }),
      route as Extract<typeof route, { keyed: true }>,
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")?.toLowerCase()).toContain("origin");
  });

  it.each([
    { label: "missing", query: "" },
    { label: "duplicate", query: "?version=v1&version=v1" },
    { label: "unsupported", query: "?version=v2" },
  ])("applies canonical CORS to $label version errors", async ({ query }) => {
    const handleSearch = createMarketRouteHandler({ namespace: "search" });
    const response = await handleSearch(
      new Request(`https://market.example.com/api/search/cities${query}`, {
        method: "GET",
        headers: { origin: "https://market.example.com" },
      }),
    );

    expect(response.status).toBe(400);
    expectCanonicalCors(response);
  });

  it("applies canonical CORS to method errors and keeps rejected HEAD bodyless", async () => {
    const handleSearch = createMarketRouteHandler({ namespace: "search" });
    const methodError = await handleSearch(
      new Request("https://market.example.com/api/search/cities?version=v1", {
        method: "POST",
        headers: { origin: "https://market.example.com" },
      }),
    );
    expect(methodError.status).toBe(405);
    expect(methodError.headers.get("allow")).toBe("GET, HEAD");
    expectCanonicalCors(methodError);

    const rejectUpdate = createMarketRejectedMethodHandler("update");
    const rejectedHead = await rejectUpdate(
      new Request("https://market.example.com/api/update/crypto-rank?version=v1", {
        method: "HEAD",
        headers: { origin: "https://market.example.com" },
      }),
    );
    expect(rejectedHead.status).toBe(405);
    expect(rejectedHead.headers.get("allow")).toBe("POST");
    expect(await rejectedHead.text()).toBe("");
    expectCanonicalCors(rejectedHead);
  });

  it("applies canonical CORS to invalid-version preflight before provider work", () => {
    const handleSearchPreflight = createMarketPreflightHandler("search");
    const response = handleSearchPreflight(
      new Request("https://market.example.com/api/search/cities?version=v2", {
        method: "OPTIONS",
        headers: {
          origin: "https://market.example.com",
          "access-control-request-method": "GET",
        },
      }),
    );

    expect(response.status).toBe(400);
    expectCanonicalCors(response);
  });

  it("does not grant early keyed responses to a foreign Origin", async () => {
    const foreignOrigin = { origin: "https://other.example.com" };
    const handleSearch = createMarketRouteHandler({ namespace: "search" });
    const rejectUpdate = createMarketRejectedMethodHandler("update");
    const handleSearchPreflight = createMarketPreflightHandler("search");
    const responses = [
      await handleSearch(
        new Request("https://market.example.com/api/search/cities?version=v2", {
          method: "GET",
          headers: foreignOrigin,
        }),
      ),
      await handleSearch(
        new Request("https://market.example.com/api/search/cities?version=v1", {
          method: "POST",
          headers: foreignOrigin,
        }),
      ),
      handleSearchPreflight(
        new Request("https://market.example.com/api/search/cities?version=v2", {
          method: "OPTIONS",
          headers: {
            ...foreignOrigin,
            "access-control-request-method": "GET",
          },
        }),
      ),
      await rejectUpdate(
        new Request("https://market.example.com/api/update/crypto-rank?version=v1", {
          method: "DELETE",
          headers: foreignOrigin,
        }),
      ),
    ];

    for (const response of responses) {
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("leaves unknown paths outside keyed CORS ownership", async () => {
    const canonicalOrigin = { origin: "https://market.example.com" };
    const handleSearch = createMarketRouteHandler({ namespace: "search" });
    const rejectSearch = createMarketRejectedMethodHandler("search");
    const handleSearchPreflight = createMarketPreflightHandler("search");
    const responses = [
      await handleSearch(
        new Request("https://market.example.com/api/search/not-a-route?version=v1", {
          method: "GET",
          headers: canonicalOrigin,
        }),
      ),
      handleSearchPreflight(
        new Request("https://market.example.com/api/search/not-a-route?version=v1", {
          method: "OPTIONS",
          headers: {
            ...canonicalOrigin,
            "access-control-request-method": "GET",
          },
        }),
      ),
      await rejectSearch(
        new Request("https://market.example.com/api/search/not-a-route?version=v1", {
          method: "DELETE",
          headers: canonicalOrigin,
        }),
      ),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toBeNull();
    }
  });
});
