import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "../../proxy";
import {
  RELEASE_REQUIRED_BASE_ENV_KEYS,
  requireBaseEnvironment,
} from "./production-server-smoke";

const runtime = vi.hoisted(() => ({ appUrl: "https://market.example.test:3000" }));
vi.mock("@/lib/environment", () => ({ getMarketRuntimeConfig: () => runtime }));

function releaseEnvironment(origin: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...Object.fromEntries(RELEASE_REQUIRED_BASE_ENV_KEYS.map((key) => [key, "release-fixture"])),
    NEXT_PUBLIC_APP_URL: origin,
    BETTER_AUTH_URL: origin,
  };
}

describe("production smoke origin", () => {
  beforeEach(() => { runtime.appUrl = "https://market.example.test:3000"; });

  it("uses a production-shaped public host different from Next's internal listening host", () => {
    const environment = releaseEnvironment(runtime.appUrl);
    expect(requireBaseEnvironment(environment).NEXT_PUBLIC_APP_URL).toBe(runtime.appUrl);
    const request = new NextRequest("https://127.0.0.1:3000/login", {
      headers: {
        host: "market.example.test:3000",
        "x-forwarded-host": "market.example.test:3000",
        "x-forwarded-proto": "https",
      },
    });
    expect(request.nextUrl.origin).toBe("https://localhost:3000");
    expect(request.nextUrl.origin).not.toBe(runtime.appUrl);
    expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["https://127.0.0.1:3000", "https://localhost:3000"])("rejects %s because loopback public hosts mask the production regression", (origin) => {
    expect(() => requireBaseEnvironment(releaseEnvironment(origin)))
      .toThrow("Release validation must use the isolated market.example.test HTTPS public origin.");
  });

  it("retains the real HTTP-to-canonical-HTTPS redirect with its path and query", () => {
    const response = proxy(new NextRequest("http://127.0.0.1:3000/login?smoke=redirect"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${runtime.appUrl}/login?smoke=redirect`);
  });

  it.each([
    ["direct public URL", "https://market.example.com/login", {}],
    ["canonical Host behind TLS termination", "http://127.0.0.1:8080/login", { host: "market.example.com", "x-forwarded-proto": "https" }],
    ["forwarded authority over internal Host", "http://127.0.0.1:8080/login", { host: "internal:8080", "x-forwarded-host": "market.example.com", "x-forwarded-proto": "https" }],
    ["default public TLS port", "http://127.0.0.1:8080/login", { "x-forwarded-host": "market.example.com:443", "x-forwarded-proto": "https", "x-forwarded-port": "8080" }],
    ["case-insensitive public host", "http://127.0.0.1:8080/login", { host: "MARKET.EXAMPLE.COM", "x-forwarded-proto": "https" }],
  ])("accepts %s without deriving configuration from headers", (_name, url, headers) => {
    runtime.appUrl = "https://market.example.com";
    const response = proxy(new NextRequest(url, { headers }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.has("location")).toBe(false);
  });

  it.each<Record<string, string>>([
    { host: "evil.example", "x-forwarded-proto": "https" },
    { host: "market.example.com", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "market.example.com:3000", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "market.example.com", "x-forwarded-proto": "http" },
    { "x-forwarded-host": "market.example.com, evil.example", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "market.example.com", "x-forwarded-proto": "https, http" },
    { "x-forwarded-host": "market.example.com@evil.example", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "market.example.com/path", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "market.example.com\\evil", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "market.example.com?ignored", "x-forwarded-proto": "https" },
    { "x-forwarded-host": "", "x-forwarded-proto": "https" },
  ])("redirects malformed, foreign, or noncanonical public headers only to the configured origin: %j", (headers) => {
    runtime.appUrl = "https://market.example.com";
    const response = proxy(new NextRequest("https://market.example.com/login?next=account", { headers }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://market.example.com/login?next=account");
  });

  it("preserves a non-default canonical public port instead of using the listening port", () => {
    const response = proxy(new NextRequest("http://127.0.0.1:8080/login", {
      headers: { host: "market.example.test:3000", "x-forwarded-proto": "https" },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("never treats a pathname as a new redirect authority", () => {
    const response = proxy(new NextRequest("http://127.0.0.1:8080//evil.example/login?next=1"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${runtime.appUrl}//evil.example/login?next=1`);
  });

  it("keeps protected-page session redirects on the configured public origin", () => {
    runtime.appUrl = "https://market.example.com";
    const response = proxy(new NextRequest("http://127.0.0.1:8080/account/api-keys?key=1", {
      headers: { host: "market.example.com", "x-forwarded-proto": "https" },
    }));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(runtime.appUrl);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("callbackUrl")).toBe("/account/api-keys?key=1");
  });

  it("applies canonical redirects to HEAD but does not rewrite browser mutation destinations", () => {
    const head = proxy(new NextRequest("http://127.0.0.1:8080/login", { method: "HEAD" }));
    expect(head.status).toBe(308);
    const post = proxy(new NextRequest("http://127.0.0.1:8080/login", { method: "POST" }));
    expect(post.headers.get("x-middleware-next")).toBe("1");
  });
});
