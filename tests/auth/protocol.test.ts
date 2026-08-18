import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({ appUrl: "https://market.example.com" }),
}));

import { AUTH_PROTOCOL_ROUTES, dispatchAuthProtocolRequest } from "../../lib/auth/protocol";

const origin = "https://market.example.com";
type RequestSecurity = {
  origin?: string | null;
  fetchSite?: string | null;
};

function request(
  path: string,
  method: string,
  body?: unknown,
  contentType = "application/json",
  security: RequestSecurity = {},
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", contentType);
  const requestOrigin = security.origin === undefined
    ? method === "POST" ? origin : null
    : security.origin;
  if (requestOrigin !== null) headers.set("origin", requestOrigin);
  if (security.fetchSite !== undefined && security.fetchSite !== null) {
    headers.set("sec-fetch-site", security.fetchSite);
  }
  return new Request(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const AUTH_POST_FIXTURES = [
  ["/api/auth/sign-up/email", {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "secret-password",
  }],
  ["/api/auth/sign-in/email", {
    email: "ada@example.com",
    password: "secret-password",
  }],
  ["/api/auth/sign-out", undefined],
  ["/api/auth/email-otp/send-verification-otp", {
    email: "ada@example.com",
    type: "sign-in",
  }],
  ["/api/auth/sign-in/email-otp", {
    email: "ada@example.com",
    otp: "012345",
  }],
  ["/api/auth/request-password-reset", {
    email: "ada@example.com",
    redirectTo: `${origin}/reset-password`,
  }],
  ["/api/auth/reset-password", {
    newPassword: "new-secret-password",
    token: "reset_token",
  }],
  ["/api/auth/update-user", { name: "Ada Lovelace" }],
  ["/api/auth/change-email", {
    newEmail: "new-ada@example.com",
    callbackURL: `${origin}/account/api-keys`,
  }],
] as const;

const REJECTED_ORIGIN_CONTEXTS = [
  ["missing", { origin: null }],
  ["opaque", { origin: "null" }],
  ["comma-joined", { origin: `${origin}, https://evil.example` }],
  ["foreign", { origin: "https://evil.example" }],
  ["same-site", { origin, fetchSite: "same-site" }],
  ["cross-site", { origin, fetchSite: "cross-site" }],
] as const;

describe("Market auth protocol", () => {
  it("owns exactly the twelve canonical route templates", () => {
    expect(AUTH_PROTOCOL_ROUTES).toEqual([
      { method: "POST", path: "/api/auth/sign-up/email" },
      { method: "POST", path: "/api/auth/sign-in/email" },
      { method: "POST", path: "/api/auth/sign-out" },
      { method: "GET", path: "/api/auth/get-session" },
      { method: "POST", path: "/api/auth/email-otp/send-verification-otp" },
      { method: "POST", path: "/api/auth/sign-in/email-otp" },
      { method: "POST", path: "/api/auth/request-password-reset" },
      { method: "GET", path: "/api/auth/reset-password/[token]" },
      { method: "POST", path: "/api/auth/reset-password" },
      { method: "POST", path: "/api/auth/update-user" },
      { method: "POST", path: "/api/auth/change-email" },
      { method: "GET", path: "/api/auth/verify-email" },
    ]);
    expect(AUTH_PROTOCOL_ROUTES.filter((route) => route.method === "POST")).toHaveLength(9);
  });

  it("resolves unknown paths and wrong methods before the unsafe-origin guard", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const unknown = await dispatchAuthProtocolRequest(
      request("/api/auth/list-sessions", "POST", undefined, "application/json", { origin: null }),
      handler,
    );
    const wrong = await dispatchAuthProtocolRequest(
      request("/api/auth/get-session", "POST", undefined, "application/json", { origin: null }),
      handler,
    );
    const head = await dispatchAuthProtocolRequest(request("/api/auth/sign-in/email", "HEAD"), handler);
    expect(unknown.status).toBe(404);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("GET");
    expect(head.status).toBe(405);
    expect(await head.text()).toBe("");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(AUTH_POST_FIXTURES)(
    "rejects every noncanonical origin context for %s before body or delegate work",
    async (path, body) => {
      const handler = vi.fn(async () => new Response(null, { status: 204 }));

      for (const [label, security] of REJECTED_ORIGIN_CONTEXTS) {
        const rejected = request(path, "POST", body, "application/json", security);
        const clone = vi.spyOn(rejected, "clone");
        const json = vi.spyOn(rejected, "json");
        const text = vi.spyOn(rejected, "text");
        const arrayBuffer = vi.spyOn(rejected, "arrayBuffer");
        const blob = vi.spyOn(rejected, "blob");
        const formData = vi.spyOn(rejected, "formData");

        const result = await dispatchAuthProtocolRequest(rejected, handler);

        expect(result.status, label).toBe(403);
        await expect(result.json()).resolves.toEqual({ error: "FORBIDDEN" });
        expect(clone, label).not.toHaveBeenCalled();
        expect(json, label).not.toHaveBeenCalled();
        expect(text, label).not.toHaveBeenCalled();
        expect(arrayBuffer, label).not.toHaveBeenCalled();
        expect(blob, label).not.toHaveBeenCalled();
        expect(formData, label).not.toHaveBeenCalled();
      }

      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each(AUTH_POST_FIXTURES)(
    "accepts the exact configured Origin for %s with absent or same-origin fetch metadata",
    async (path, body) => {
      const handler = vi.fn(async () => new Response(null, { status: 204 }));

      for (const fetchSite of [null, "same-origin"] as const) {
        const result = await dispatchAuthProtocolRequest(
          request(path, "POST", body, "application/json", { origin, fetchSite }),
          handler,
        );
        expect(result.status, String(fetchSite)).toBe(204);
      }

      expect(handler).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    "/api/auth/get-session",
    "/api/auth/reset-password/reset_token",
    "/api/auth/verify-email?token=verify_token",
  ])("allows the owned GET without Origin: %s", async (path) => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchAuthProtocolRequest(request(path, "GET"), handler);

    expect(result.status).toBe(204);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("reconstructs the exact signup body with only a trimmed name", async () => {
    let body: unknown;
    const handler = vi.fn(async (accepted: Request) => {
      body = await accepted.json();
      return new Response(null, { status: 204 });
    });
    const result = await dispatchAuthProtocolRequest(
      request("/api/auth/sign-up/email", "POST", {
        name: "  Ada Lovelace  ",
        email: "ADA@EXAMPLE.COM",
        password: "secret-password",
      }),
      handler,
    );
    expect(result.status).toBe(204);
    expect(body).toEqual({ name: "Ada Lovelace", email: "ADA@EXAMPLE.COM", password: "secret-password" });
  });

  it.each([
    [{ name: "Ada", email: "ada@example.com", password: "secret", image: "" }],
    [{ name: "Ada", email: "invalid", password: "secret" }],
    [{ name: "", email: "ada@example.com", password: "secret" }],
    [{ name: "Ada", email: "ada@example.com", password: "" }],
  ])("rejects a non-canonical signup body %#", async (body) => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchAuthProtocolRequest(request("/api/auth/sign-up/email", "POST", body), handler);
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: "INVALID_SIGNUP_REQUEST" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("checks signup media type before cloning or reading the body", async () => {
    const rejected = request(
      "/api/auth/sign-up/email",
      "POST",
      { name: "Ada", email: "ada@example.com", password: "secret" },
      "text/plain",
    );
    const clone = vi.spyOn(rejected, "clone");
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    expect((await dispatchAuthProtocolRequest(rejected, handler)).status).toBe(400);
    expect(clone).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts normalized JSON parameters but rejects malformed parameters before body work", async () => {
    const body = { name: "Ada", email: "ada@example.com", password: "secret" };
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    expect((await dispatchAuthProtocolRequest(
      request("/api/auth/sign-up/email", "POST", body, " Application/JSON ; charset=utf-8 "),
      handler,
    )).status).toBe(204);

    const malformed = request("/api/auth/sign-up/email", "POST", body, "application/json;");
    const clone = vi.spyOn(malformed, "clone");
    expect((await dispatchAuthProtocolRequest(malformed, handler)).status).toBe(400);
    expect(clone).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/auth/email-otp/send-verification-otp", { email: "ada@example.com", type: "sign-in" }],
    ["/api/auth/sign-in/email-otp", { email: "ada@example.com", otp: "012345" }],
  ])("delegates the exact OTP body for %s", async (path, body) => {
    let delegated: unknown;
    const handler = vi.fn(async (accepted: Request) => {
      delegated = await accepted.json();
      return new Response(null, { status: 204 });
    });
    expect((await dispatchAuthProtocolRequest(request(path, "POST", body), handler)).status).toBe(204);
    expect(delegated).toEqual(body);
  });

  it.each([
    ["/api/auth/email-otp/send-verification-otp", { email: "ada@example.com", type: "email-verification" }],
    ["/api/auth/email-otp/send-verification-otp", { email: "ada@example.com", type: "sign-in", extra: false }],
    ["/api/auth/sign-in/email-otp", { email: "ada@example.com", otp: "12345" }],
    ["/api/auth/sign-in/email-otp", { email: "ada@example.com", otp: "123456", rememberMe: false }],
  ])("rejects a non-canonical OTP body for %s", async (path, body) => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await dispatchAuthProtocolRequest(request(path, "POST", body), handler);
    expect(result.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("accepts only a trimmed display-name update", async () => {
    let delegated: unknown;
    const handler = vi.fn(async (accepted: Request) => {
      delegated = await accepted.json();
      return new Response(null, { status: 204 });
    });
    const accepted = await dispatchAuthProtocolRequest(request("/api/auth/update-user", "POST", { name: "  Ada  " }), handler);
    const rejected = await dispatchAuthProtocolRequest(request("/api/auth/update-user", "POST", { name: "Ada", image: null }), handler);
    expect(accepted.status).toBe(204);
    expect(delegated).toEqual({ name: "Ada" });
    expect(rejected.status).toBe(400);
  });

  it("accepts exactly one non-empty reset token segment", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    expect((await dispatchAuthProtocolRequest(request("/api/auth/reset-password/token_123", "GET"), handler)).status).toBe(204);
    expect((await dispatchAuthProtocolRequest(request("/api/auth/reset-password/token_123/extra", "GET"), handler)).status).toBe(404);
    expect((await dispatchAuthProtocolRequest(request("/api/auth/reset-password/token%2Fextra", "GET"), handler)).status).toBe(404);
  });

  it("rejects every non-owned method before any adapter side effect", async () => {
    const handler = vi.fn(async () => { throw new Error("must not run"); });
    for (const route of AUTH_PROTOCOL_ROUTES) {
      const path = route.path.replace("[token]", "token");
      for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        if (method === route.method) continue;
        const result = await dispatchAuthProtocolRequest(request(path, method), handler);
        expect(result.status, `${method} ${path}`).toBe(405);
        expect(result.headers.get("allow")).toBe(route.method);
      }
    }
    expect(handler).not.toHaveBeenCalled();
  });
});
