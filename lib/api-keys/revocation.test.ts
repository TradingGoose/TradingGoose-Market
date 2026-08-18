import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmProviderKeyRevocation } from "./revocation";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API key provider revocation reconciliation", () => {
  it.each([
    [null, { status: "revoked", retryable: false }],
    [{ enabled: false }, { status: "revoked", retryable: false }],
    [{ enabled: true }, { status: "revocation_pending", retryable: true }],
    [{}, { status: "revocation_pending", retryable: true }],
  ] as const)("classifies the observed provider state %#", async (observed, expected) => {
    const provider = providerDouble();
    provider.getKey.mockResolvedValue(observed as never);

    await expect(
      confirmProviderKeyRevocation("provider_key", provider.value),
    ).resolves.toEqual(expected);
    expect(provider.deleteKey).toHaveBeenCalledOnce();
    expect(provider.getKey).toHaveBeenCalledOnce();
  });

  it("returns retryable pending when soft deletion fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = providerDouble();
    provider.deleteKey.mockRejectedValue(new Error("transport"));

    await expect(
      confirmProviderKeyRevocation("provider_key", provider.value),
    ).resolves.toEqual({ status: "revocation_pending", retryable: true });
    expect(provider.getKey).not.toHaveBeenCalled();
  });

  it("returns retryable pending when confirmation lookup fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = providerDouble();
    provider.getKey.mockRejectedValue(new Error("transport"));

    await expect(
      confirmProviderKeyRevocation("provider_key", provider.value),
    ).resolves.toEqual({ status: "revocation_pending", retryable: true });
  });
});

function providerDouble() {
  const deleteKey = vi.fn(async () => undefined);
  const getKey = vi.fn(async () => null);
  return {
    deleteKey,
    getKey,
    value: { deleteKey, getKey } as Parameters<
      typeof confirmProviderKeyRevocation
    >[1],
  };
}
