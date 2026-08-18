import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, test } from "vitest";

import { handleMarketPreflight } from "@/lib/market-api/core/cors";
import {
  MARKET_API_ROUTE_MANIFEST,
  getMarketRouteDescriptorByTemplate,
  resolveKeyedMarketRoute,
  resolveMarketRouteDescriptor,
} from "@/lib/market-api/core/manifest";
import { marketMethodNotAllowed } from "@/lib/market-api/core/method-guards";
import { createMarketRejectedMethodHandler } from "@/lib/market-api/core/route-handler";
import { requireApiVersion } from "@/lib/market-api/core/version";
import { clearMarketRuntimeConfigCacheForTests } from "@/lib/environment";

const expectedKeyedRoutes = [
  ["GET|HEAD", "/api/search", "public-read", "public.search", "market_instrument", "Market Instrument"],
  ["GET|HEAD", "/api/search/cities", "public-read", "public.search.cities", "city", "City"],
  ["GET|HEAD", "/api/search/countries", "public-read", "public.search.countries", "country", "Country"],
  ["GET|HEAD", "/api/search/currencies", "public-read", "public.search.currencies", "currency", "Currency"],
  ["GET|HEAD", "/api/search/cryptos", "public-read", "public.search.cryptos", "crypto", "Cryptocurrency"],
  ["GET|HEAD", "/api/search/exchanges", "public-read", "public.search.exchanges", "exchange", "Exchange"],
  ["GET|HEAD", "/api/search/listings", "public-read", "public.search.listings", "listing_identity", "Listing Identity"],
  ["GET|HEAD", "/api/get/crypto", "public-read", "public.get.crypto", "crypto", "Cryptocurrency"],
  ["GET|HEAD", "/api/get/currency", "public-read", "public.get.currency", "currency", "Currency"],
  ["GET|HEAD", "/api/get/listing", "public-read", "public.get.listing", "listing_identity", "Listing Identity"],
  ["GET|HEAD", "/api/get/market-hours", "public-read", "public.get.market-hours", "market_hour", "Market Hours"],
  ["GET|HEAD", "/api/get/timezone", "public-read", "public.get.timezone", "timezone", "Timezone"],
  ["POST", "/api/update/crypto-rank", "private-key", "private.update.crypto-rank", "crypto", "Cryptocurrency"],
  ["POST", "/api/update/crypto-rank/decay", "private-key", "private.update.crypto-rank.decay", "crypto", "Cryptocurrency"],
  ["POST", "/api/update/currency-rank", "private-key", "private.update.currency-rank", "currency", "Currency"],
  ["POST", "/api/update/currency-rank/decay", "private-key", "private.update.currency-rank.decay", "currency", "Currency"],
  ["POST", "/api/update/listing-rank", "private-key", "private.update.listing-rank", "listing_identity", "Listing Identity"],
  ["POST", "/api/update/listing-rank/decay", "private-key", "private.update.listing-rank.decay", "listing_identity", "Listing Identity"],
] as const;

describe("Market route manifest", () => {
  test("is a unique finite 82-row inventory", () => {
    assert.equal(MARKET_API_ROUTE_MANIFEST.length, 82);
    assert.equal(
      new Set(MARKET_API_ROUTE_MANIFEST.map((descriptor) => descriptor.path)).size,
      MARKET_API_ROUTE_MANIFEST.length,
    );
  });

  test("contains the exact keyed method/category/resource contract", () => {
    const actual = MARKET_API_ROUTE_MANIFEST.filter((descriptor) => descriptor.keyed).map(
      (descriptor) => [
        descriptor.methods.join("|"),
        descriptor.path,
        descriptor.access,
        descriptor.category,
        descriptor.resource.id,
        descriptor.resource.label,
      ],
    );
    assert.deepEqual(actual, expectedKeyedRoutes);
  });

  test("contains only keyed CORS owners", () => {
    for (const descriptor of MARKET_API_ROUTE_MANIFEST) {
      assert.equal(descriptor.cors !== null, descriptor.keyed);
      assert.equal(descriptor.category !== null, descriptor.keyed);
      assert.equal(descriptor.resource !== null, descriptor.keyed);
    }
  });

  test("contains the exact browser, entity, auth, webhook, support, and rewrite rows", () => {
    const expected = new Map<string, readonly [string, string, string]>([
      ["/api/account/billing", ["GET", "customer-session", "browser"]],
      ["/api/account/billing/payg/activate", ["POST", "customer-session", "browser"]],
      ["/api/account/billing/portal", ["POST", "customer-session", "browser"]],
      ["/api/account/api-keys", ["GET|POST", "customer-session", "browser"]],
      ["/api/account/api-keys/[id]", ["GET|PATCH|DELETE", "customer-session", "browser"]],
      ["/api/account/activity", ["GET", "customer-session", "browser"]],
      ["/api/account/logs", ["GET", "customer-session", "browser"]],
      ["/api/account/profile/image", ["POST|DELETE", "customer-session", "browser"]],
      ["/api/admin/api-keys", ["GET|POST", "system-admin-session", "browser"]],
      ["/api/admin/api-keys/[id]", ["DELETE", "system-admin-session", "browser"]],
      ["/api/admin/api-usage", ["GET", "system-admin-session", "browser"]],
      ["/api/auth/sign-up/email", ["POST", "auth-public-same-origin", "auth"]],
      ["/api/auth/sign-in/email", ["POST", "auth-public-same-origin", "auth"]],
      ["/api/auth/sign-out", ["POST", "auth-session-same-origin", "auth"]],
      ["/api/auth/get-session", ["GET", "auth-session-same-origin", "auth"]],
      ["/api/auth/email-otp/send-verification-otp", ["POST", "auth-public-same-origin", "auth"]],
      ["/api/auth/sign-in/email-otp", ["POST", "auth-public-same-origin", "auth"]],
      ["/api/auth/request-password-reset", ["POST", "auth-public-same-origin", "auth"]],
      ["/api/auth/reset-password/[token]", ["GET", "auth-callback", "auth"]],
      ["/api/auth/reset-password", ["POST", "auth-public-same-origin", "auth"]],
      ["/api/auth/update-user", ["POST", "auth-session-same-origin", "auth"]],
      ["/api/auth/change-email", ["POST", "auth-sensitive-session", "auth"]],
      ["/api/auth/verify-email", ["GET", "auth-callback", "auth"]],
      ["/api/billing/stripe/webhook", ["POST", "stripe-webhook", "protocol"]],
      ["/api/health", ["GET|HEAD", "public-support", "support"]],
      ["/api/files/serve/[...key]", ["GET|HEAD", "public-support", "support"]],
      ["/api/github-stars", ["GET|HEAD", "public-support", "support"]],
      ["/health", ["GET|HEAD", "support-rewrite", "rewrite"]],
      ["/files/serve/[...key]", ["GET|HEAD", "support-rewrite", "rewrite"]],
    ]);

    const rootNames = [
      "chains",
      "cities",
      "countries",
      "cryptos",
      "currencies",
      "exchanges",
      "listings",
      "markets",
      "time-zones",
    ];
    for (const name of rootNames) {
      expected.set(`/api/${name}`, ["GET|HEAD|POST", "system-admin-session", "entity"]);
      expected.set(`/api/${name}/[id]`, ["PATCH|DELETE", "system-admin-session", "entity"]);
      expected.set(`/api/${name}/export`, ["GET|HEAD", "system-admin-session", "entity"]);
    }
    expected.set("/api/market-hours", ["GET|HEAD", "system-admin-session", "entity"]);
    expected.set("/api/market-hours/[id]", ["DELETE", "system-admin-session", "entity"]);
    expected.set("/api/market-hours/export", ["GET|HEAD", "system-admin-session", "entity"]);
    for (const name of [
      "chain-icon",
      "country-icon",
      "crypto-icon",
      "currency-icon",
      "listing-icon",
    ]) {
      expected.set(`/api/uploads/${name}`, ["POST", "system-admin-session", "entity"]);
    }

    const actual = new Map(
      MARKET_API_ROUTE_MANIFEST.filter((descriptor) => !descriptor.keyed).map(
        (descriptor) => [
          descriptor.path,
          [descriptor.methods.join("|"), descriptor.access, descriptor.surface] as const,
        ],
      ),
    );
    assert.deepEqual(actual, expected);
  });

  test("resolves only exact keyed routes and finite dynamic browser/support rows", () => {
    assert.equal(resolveKeyedMarketRoute("/api/search/cities")?.id, "public.search.cities");
    assert.equal(resolveKeyedMarketRoute("/api/search/cities/extra"), null);
    assert.equal(resolveKeyedMarketRoute("/api/get"), null);
    assert.equal(resolveKeyedMarketRoute("/api/update"), null);
    assert.equal(resolveKeyedMarketRoute(`/${"search"}/cities`), null);
    assert.equal(resolveMarketRouteDescriptor("/api/chains/abc")?.path, "/api/chains/[id]");
    assert.equal(
      resolveMarketRouteDescriptor("/api/files/serve/icons/example.png")?.path,
      "/api/files/serve/[...key]",
    );
    assert.equal(resolveMarketRouteDescriptor("/api/files/serve"), null);
  });

  test("method rejection uses the descriptor's exact Allow value", async () => {
    const descriptor = getMarketRouteDescriptorByTemplate("/api/account/billing");
    const response = marketMethodNotAllowed(descriptor, "OPTIONS");
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
  });

  test("keyed catch-alls distinguish known wrong methods from unknown suffixes", async () => {
    const rejectSearch = createMarketRejectedMethodHandler("search");
    const known = await rejectSearch(
      new Request("https://market.example.com/api/search/cities?version=v1", { method: "POST" }),
    );
    assert.equal(known.status, 405);
    assert.equal(known.headers.get("allow"), "GET, HEAD");

    const unknown = await rejectSearch(
      new Request("https://market.example.com/api/search/unknown?version=v1", { method: "POST" }),
    );
    assert.equal(unknown.status, 404);

    const rejectUpdate = createMarketRejectedMethodHandler("update");
    const head = await rejectUpdate(
      new Request("https://market.example.com/api/update/crypto-rank?version=v1", { method: "HEAD" }),
    );
    assert.equal(head.status, 405);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("allow"), "POST");
  });
});

describe("Market keyed protocol guards", () => {
  const requiredEnvironment = {
    DATABASE_URL: "postgres://market:market@localhost:5432/market_test",
    NEXT_PUBLIC_APP_URL: "https://market.example.com",
    BETTER_AUTH_URL: "https://market.example.com",
    BETTER_AUTH_SECRET: "test-better-auth-secret",
    RESEND_API_KEY: "re_test",
    RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
    REGISTRATION_MODE: "open",
    BILLING_ENABLED: "false",
    PAYG_USD_PER_1000_READS: "1",
    UNKEY_API_ID: "test-api-id",
    UNKEY_KEY_MANAGEMENT_ROOT_KEY: "test-management-key",
    UNKEY_KEY_VERIFY_ROOT_KEY: "test-verify-key",
  } as const;
  const originalValues = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const [name, value] of Object.entries(requiredEnvironment)) {
      originalValues.set(name, process.env[name]);
      process.env[name] = value;
    }
    clearMarketRuntimeConfigCacheForTests();
  });

  afterAll(() => {
    for (const [name, value] of originalValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    clearMarketRuntimeConfigCacheForTests();
  });

  test("requires the one exact version query value", async () => {
    assert.equal(requireApiVersion(new Request("https://market.example.com/api/search?version=v1")), null);
    for (const url of [
      "https://market.example.com/api/search",
      "https://market.example.com/api/search?version=1",
      "https://market.example.com/api/search?version=V1",
      "https://market.example.com/api/search?version=v1&version=v1",
      "https://market.example.com/api/search?version=v10",
    ]) {
      assert.equal(requireApiVersion(new Request(url))?.status, 400);
    }
  });

  test("serves canonical public preflight without reflecting request headers", async () => {
    const descriptor = resolveKeyedMarketRoute("/api/search/cities");
    assert.ok(descriptor);
    const response = handleMarketPreflight(
      new Request("https://market.example.com/api/search/cities?version=v1", {
        method: "OPTIONS",
        headers: {
          Origin: "https://market.example.com",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "x-title, x-api-key",
        },
      }),
      descriptor,
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://market.example.com");
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
    assert.equal(
      response.headers.get("access-control-allow-headers"),
      "x-api-key, http-referer, x-title",
    );
  });

  test("rejects noncanonical origins and unsupported headers", async () => {
    const descriptor = resolveKeyedMarketRoute("/api/update/crypto-rank");
    assert.ok(descriptor);
    const wrongOrigin = handleMarketPreflight(
      new Request("https://market.example.com/api/update/crypto-rank?version=v1", {
        method: "OPTIONS",
        headers: {
          Origin: "https://other.example.com",
          "Access-Control-Request-Method": "POST",
        },
      }),
      descriptor,
    );
    assert.equal(wrongOrigin.status, 403);

    const unsupportedHeader = handleMarketPreflight(
      new Request("https://market.example.com/api/update/crypto-rank?version=v1", {
        method: "OPTIONS",
        headers: {
          Origin: "https://market.example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "authorization",
        },
      }),
      descriptor,
    );
    assert.equal(unsupportedHeader.status, 400);
  });
});
