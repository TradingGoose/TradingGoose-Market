import { beforeEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({
  updateAllowance: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  apiRequireCustomerSession: vi.fn(async () => ({
    error: null,
    user: { id: "user_1" },
  })),
}));

vi.mock("@/lib/api-keys/revocation", () => ({
  revokeCustomerApiKey: vi.fn(),
}));

vi.mock("@/lib/api-keys/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-keys/service")>(
    "@/lib/api-keys/service",
  );
  return {
    ...actual,
    getCustomerApiKeyDetail: vi.fn(),
    updateCustomerApiKeyAllowance: service.updateAllowance,
  };
});

import { PATCH } from "../../app/api/account/api-keys/[id]/route";
import { ApiKeyRevisionConflict } from "../../lib/api-keys/service";

const context = { params: Promise.resolve({ id: "key_1" }) };

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/account/api-keys/key_1", {
    method: "PATCH",
    headers: {
      origin: "https://market.example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  service.updateAllowance.mockReset();
  service.updateAllowance.mockResolvedValue({ id: "key_1" });
});

describe("customer API key allowance PATCH contract", () => {
  it.each([
    ["both allowance fields missing", { expectedRevision: 4 }],
    ["limit missing", { expectedRevision: 4, windowDays: 7 }],
    ["window missing", { expectedRevision: 4, limitUsd: "5" }],
    ["mixed null limit", { expectedRevision: 4, limitUsd: null, windowDays: 7 }],
    ["mixed null window", { expectedRevision: 4, limitUsd: "5", windowDays: null }],
  ])("rejects %s before invoking the mutation service", async (_label, body) => {
    const response = await PATCH(patchRequest(body), context);

    expect(response.status).toBe(400);
    expect(service.updateAllowance).not.toHaveBeenCalled();
  });

  it.each([
    [
      "finite",
      { expectedRevision: 4, limitUsd: "5", windowDays: 7 },
      { limitUsd: "5", windowDays: 7 },
    ],
    [
      "unlimited",
      { expectedRevision: 5, limitUsd: null, windowDays: null },
      { limitUsd: null, windowDays: null },
    ],
  ] as const)("accepts an explicitly owned %s allowance pair", async (_label, body, allowance) => {
    const response = await PATCH(patchRequest(body), context);

    expect(response.status).toBe(200);
    expect(service.updateAllowance).toHaveBeenCalledWith({
      userId: "user_1",
      keyId: "key_1",
      expectedRevision: body.expectedRevision,
      allowance,
    });
  });

  it("preserves 409 for a well-formed stale expected revision", async () => {
    service.updateAllowance.mockRejectedValueOnce(
      new ApiKeyRevisionConflict("API key allowance revision is stale"),
    );

    const response = await PATCH(
      patchRequest({ expectedRevision: 3, limitUsd: "5", windowDays: 7 }),
      context,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "API key allowance revision is stale",
    });
    expect(service.updateAllowance).toHaveBeenCalledTimes(1);
  });
});
