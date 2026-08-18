import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getSession: vi.fn(),
  ensureCustomer: vi.fn(),
  getAdmin: vi.fn(),
  requireDatabase: vi.fn(),
  selectMarketHour: vi.fn(),
  deleteMarketHour: vi.fn(),
  createCustomerKey: vi.fn(),
  createAdminKey: vi.fn(),
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({ appUrl: "https://market.example.com" }),
}));

vi.mock("@/lib/market-api/core/manifest", () => ({
  getMarketRouteDescriptorByTemplate: (template: string) => template === "/api/account/api-keys"
    ? { methods: ["GET", "POST"], access: "customer-session" }
    : template === "/api/admin/api-keys"
      ? { methods: ["GET", "POST"], access: "system-admin-session" }
      : { methods: ["DELETE"], access: "system-admin-session" },
}));

vi.mock("@tradinggoose/db", () => ({
  schema: { marketHours: { id: "id" } },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => true) }));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: state.getSession } },
}));

vi.mock("@/lib/billing/customer-state", () => ({
  ensureMarketCustomerState: state.ensureCustomer,
}));

vi.mock("@/lib/admin/access", () => ({
  getCurrentSystemAdmin: state.getAdmin,
}));

vi.mock("@/lib/db/runtime", () => ({
  requireDatabase: state.requireDatabase,
}));

vi.mock("@/lib/api-keys/creation", () => ({
  ApiKeyCreationConflict: class ApiKeyCreationConflict extends Error {},
  createCustomerApiKey: state.createCustomerKey,
  createAdminApiKey: state.createAdminKey,
}));

vi.mock("@/lib/api-keys/service", () => ({
  listCustomerApiKeys: vi.fn(),
  listAdminApiKeys: vi.fn(),
}));

import {
  apiRequireCustomerSession,
  apiRequireSystemAdmin,
} from "../../lib/auth/session";
import { POST as createCustomerKey } from "../../app/api/account/api-keys/route";
import { POST as createAdminKey } from "../../app/api/admin/api-keys/route";
import { DELETE as deleteMarketHour } from "../../app/api/market-hours/[id]/route";

const user = {
  id: "user_1",
  name: "Market User",
  email: "market@example.com",
  emailVerified: true,
};

function mutationRequest(headers: HeadersInit = {}) {
  return new Request("https://market.example.com/api/account/api-keys", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.getSession.mockResolvedValue({ user });
  state.ensureCustomer.mockResolvedValue(undefined);
  state.getAdmin.mockResolvedValue({ id: "grant_1", userId: user.id });
  state.selectMarketHour.mockResolvedValue([{ id: "hours_1" }]);
  state.deleteMarketHour.mockResolvedValue(undefined);
  state.createCustomerKey.mockResolvedValue({ id: "customer_key_1" });
  state.createAdminKey.mockResolvedValue({ id: "admin_key_1" });
  state.requireDatabase.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({ limit: state.selectMarketHour }),
      }),
    }),
    delete: () => ({ where: state.deleteMarketHour }),
  });
});

describe("same-origin browser mutation guard", () => {
  it.each([
    ["missing Origin", {}],
    ["opaque Origin", { origin: "null" }],
    ["comma-joined Origin", { origin: "https://market.example.com, https://evil.example" }],
    ["cross-origin", { origin: "https://evil.example" }],
    ["same-site fetch context", {
      origin: "https://market.example.com",
      "sec-fetch-site": "same-site",
    }],
    ["cross-site fetch context", {
      origin: "https://market.example.com",
      "sec-fetch-site": "cross-site",
    }],
  ])("rejects a customer %s request before session work", async (_label, headers) => {
    const result = await apiRequireCustomerSession(mutationRequest(headers));

    expect(result.error?.status).toBe(403);
    await expect(result.error?.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.ensureCustomer).not.toHaveBeenCalled();
  });

  it("accepts the exact configured Origin and an optional same-origin fetch context", async () => {
    const result = await apiRequireCustomerSession(mutationRequest({
      origin: "https://market.example.com",
      "sec-fetch-site": "same-origin",
    }));

    expect(result.error).toBeUndefined();
    expect(result.user).toEqual(user);
    expect(state.getSession).toHaveBeenCalledOnce();
    expect(state.ensureCustomer).toHaveBeenCalledWith(user.id);
  });

  it("protects a customer route before its body and provider work", async () => {
    const request = mutationRequest();
    const readBody = vi.spyOn(request, "json");
    const response = await createCustomerKey(request);

    expect(response.status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.createCustomerKey).not.toHaveBeenCalled();
  });

  it("allows the canonical customer route request", async () => {
    const response = await createCustomerKey(new Request(
      "https://market.example.com/api/account/api-keys",
      {
        method: "POST",
        headers: {
          origin: "https://market.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Customer key" }),
      },
    ));

    expect(response.status).toBe(201);
    expect(state.createCustomerKey).toHaveBeenCalledWith({
      userId: user.id,
      name: "Customer key",
      allowance: { limitUsd: null, windowDays: null },
    });
  });

  it("does not impose Origin on safe browser reads", async () => {
    const result = await apiRequireCustomerSession(new Request(
      "https://market.example.com/api/account/activity",
    ));

    expect(result.error).toBeUndefined();
    expect(state.getSession).toHaveBeenCalledOnce();
  });

  it("rejects an unsafe admin request before session or membership work", async () => {
    const result = await apiRequireSystemAdmin(mutationRequest({
      origin: "https://market.example.com",
      "sec-fetch-site": "same-site",
    }));

    expect(result.error?.status).toBe(403);
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.getAdmin).not.toHaveBeenCalled();
  });

  it("accepts the canonical admin mutation request", async () => {
    const result = await apiRequireSystemAdmin(mutationRequest({
      origin: "https://market.example.com",
    }));

    expect(result.error).toBeUndefined();
    if (!("systemAdmin" in result)) throw new Error("Expected an admin guard result.");
    expect(result.systemAdmin).toEqual({ id: "grant_1", userId: user.id });
    expect(state.getAdmin).toHaveBeenCalledWith(user.id);
  });

  it("protects an admin route before its body and provider work", async () => {
    const request = mutationRequest({ origin: "https://evil.example" });
    const readBody = vi.spyOn(request, "json");
    const response = await createAdminKey(request);

    expect(response.status).toBe(403);
    expect(readBody).not.toHaveBeenCalled();
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.getAdmin).not.toHaveBeenCalled();
    expect(state.createAdminKey).not.toHaveBeenCalled();
  });

  it("allows the canonical admin route request", async () => {
    const response = await createAdminKey(new Request(
      "https://market.example.com/api/admin/api-keys",
      {
        method: "POST",
        headers: {
          origin: "https://market.example.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Admin key" }),
      },
    ));

    expect(response.status).toBe(201);
    expect(state.createAdminKey).toHaveBeenCalledWith({
      userId: user.id,
      adminGrantId: "grant_1",
      name: "Admin key",
    });
  });

  it("rejects an entity mutation before session, params, or database work", async () => {
    const response = await deleteMarketHour(
      new Request("https://market.example.com/api/market-hours/hours_1", {
        method: "DELETE",
        headers: { origin: "https://evil.example" },
      }),
      { params: Promise.resolve({ id: "hours_1" }) },
    );

    expect(response.status).toBe(403);
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.getAdmin).not.toHaveBeenCalled();
    expect(state.requireDatabase).not.toHaveBeenCalled();
  });

  it("allows the canonical entity mutation through its admin and database owners", async () => {
    const response = await deleteMarketHour(
      new Request("https://market.example.com/api/market-hours/hours_1", {
        method: "DELETE",
        headers: {
          origin: "https://market.example.com",
          "sec-fetch-site": "same-origin",
        },
      }),
      { params: Promise.resolve({ id: "hours_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { id: "hours_1" } });
    expect(state.getSession).toHaveBeenCalledOnce();
    expect(state.getAdmin).toHaveBeenCalledWith(user.id);
    expect(state.requireDatabase).toHaveBeenCalledTimes(2);
    expect(state.deleteMarketHour).toHaveBeenCalledOnce();
  });
});
