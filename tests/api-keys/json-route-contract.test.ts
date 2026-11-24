import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createCustomer: vi.fn(),
  updateCustomer: vi.fn(),
  createAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  apiRequireCustomerSession: vi.fn(async () => ({
    error: null,
    user: { id: "user_1" },
  })),
  apiRequireSystemAdmin: vi.fn(async () => ({
    error: null,
    user: { id: "admin_user_1" },
    systemAdmin: { id: "grant_1" },
  })),
}));

vi.mock("@/lib/api-keys/creation", () => ({
  ApiKeyCreationConflict: class ApiKeyCreationConflict extends Error {},
  createCustomerApiKey: state.createCustomer,
  createAdminApiKey: state.createAdmin,
}));

vi.mock("@/lib/api-keys/revocation", () => ({
  revokeCustomerApiKey: vi.fn(),
}));

vi.mock("@/lib/api-keys/service", () => ({
  ApiKeyNotFoundError: class ApiKeyNotFoundError extends Error {},
  ApiKeyRevisionConflict: class ApiKeyRevisionConflict extends Error {},
  getCustomerApiKeyDetail: vi.fn(),
  listAdminApiKeys: vi.fn(),
  listCustomerApiKeys: vi.fn(),
  updateCustomerApiKeyAllowance: state.updateCustomer,
}));

import { POST as createCustomerKey } from "../../app/api/account/api-keys/route";
import { PATCH as updateCustomerKey } from "../../app/api/account/api-keys/[id]/route";
import { POST as createAdminKey } from "../../app/api/admin/api-keys/route";

const keyContext = { params: Promise.resolve({ id: "key_1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API-key JSON route contract", () => {
  const routes = [
    {
      name: "customer create",
      invoke: (request: Request) => createCustomerKey(request),
      service: state.createCustomer,
    },
    {
      name: "customer update",
      invoke: (request: Request) => updateCustomerKey(request, keyContext),
      service: state.updateCustomer,
    },
    {
      name: "admin create",
      invoke: (request: Request) => createAdminKey(request),
      service: state.createAdmin,
    },
  ] as const;

  it.each(routes)("returns 400 for malformed JSON in $name", async ({ invoke, service }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await invoke(jsonRequest("{"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "request body must be valid JSON",
    });
    expect(service).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each(routes)("returns 400 for an empty body in $name", async ({ invoke, service }) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await invoke(jsonRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "request body must be valid JSON",
    });
    expect(service).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

function jsonRequest(body?: string) {
  return new Request("https://market.example.com/api/account/api-keys", {
    method: "POST",
    headers: {
      origin: "https://market.example.com",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body }),
  });
}
