import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({
  customerOutcome: {
    status: "revoked" as "revoked" | "revocation_pending",
    retryable: false as boolean,
  },
  adminOutcome: {
    status: "revoked" as "revoked" | "revocation_pending",
    retryable: false as boolean,
  },
}));

vi.mock("@/lib/auth/session", () => ({
  apiRequireCustomerSession: vi.fn(async () => ({
    error: null,
    user: { id: "user_1" },
  })),
  apiRequireSystemAdmin: vi.fn(async () => ({
    error: null,
    user: { id: "admin_user" },
    systemAdmin: { id: "grant_1" },
  })),
}));

vi.mock("@/lib/api-keys/revocation", () => ({
  revokeCustomerApiKey: vi.fn(async () => ({ ...routeState.customerOutcome })),
  revokeAdminApiKey: vi.fn(async () => ({ ...routeState.adminOutcome })),
}));

import { DELETE as deleteCustomerKey } from "../../app/api/account/api-keys/[id]/route";
import { DELETE as deleteAdminKey } from "../../app/api/admin/api-keys/[id]/route";

beforeEach(() => {
  routeState.customerOutcome = { status: "revoked", retryable: false };
  routeState.adminOutcome = { status: "revoked", retryable: false };
});

describe("API key revocation route outcomes", () => {
  it.each([
    ["customer", deleteCustomerKey],
    ["admin", deleteAdminKey],
  ] as const)("returns 200 for confirmed %s revocation", async (_kind, handler) => {
    const response = await handler(
      new Request("http://localhost/api/key", {
        method: "DELETE",
        headers: { origin: "https://market.example.com" },
      }),
      { params: Promise.resolve({ id: "key_1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "revoked",
      retryable: false,
    });
  });

  it("returns 202 for retryable customer revocation pending", async () => {
    routeState.customerOutcome = {
      status: "revocation_pending",
      retryable: true,
    };

    const response = await deleteCustomerKey(
      new Request("http://localhost/api/key", {
        method: "DELETE",
        headers: { origin: "https://market.example.com" },
      }),
      { params: Promise.resolve({ id: "key_1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "revocation_pending",
      retryable: true,
    });
  });

  it("returns 202 for retryable admin revocation pending", async () => {
    routeState.adminOutcome = {
      status: "revocation_pending",
      retryable: true,
    };

    const response = await deleteAdminKey(
      new Request("http://localhost/api/key", {
        method: "DELETE",
        headers: { origin: "https://market.example.com" },
      }),
      { params: Promise.resolve({ id: "key_1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "revocation_pending",
      retryable: true,
    });
  });
});
