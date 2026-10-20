import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { proxy } from "../../proxy";
import {
  RELEASE_REQUIRED_BASE_ENV_KEYS,
  requireBaseEnvironment,
} from "./production-server-smoke";

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({ appUrl: "https://localhost:3000" }),
}));

function releaseEnvironment(origin: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...Object.fromEntries(RELEASE_REQUIRED_BASE_ENV_KEYS.map((key) => [key, "release-fixture"])),
    NEXT_PUBLIC_APP_URL: origin,
    BETTER_AUTH_URL: origin,
  };
}

describe("production smoke origin", () => {
  it("uses the localhost public origin that NextRequest actually preserves", () => {
    const environment = releaseEnvironment("https://localhost:3000");
    expect(requireBaseEnvironment(environment).NEXT_PUBLIC_APP_URL).toBe("https://localhost:3000");
    const request = new NextRequest("https://127.0.0.1:3000/login");
    expect(request.nextUrl.origin).toBe("https://localhost:3000");
    expect(proxy(request).headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a public origin that NextRequest would normalize into a different origin", () => {
    expect(() => requireBaseEnvironment(releaseEnvironment("https://127.0.0.1:3000")))
      .toThrow("Release validation must use an explicit localhost HTTPS public origin.");
  });

  it("retains the real HTTP-to-canonical-HTTPS redirect with its path and query", () => {
    const response = proxy(new NextRequest("http://127.0.0.1:3000/login?smoke=redirect"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://localhost:3000/login?smoke=redirect");
  });
});
