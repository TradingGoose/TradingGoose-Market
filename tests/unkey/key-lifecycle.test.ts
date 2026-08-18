import { afterEach, describe, expect, it, vi } from "vitest";

import { maskRawKey } from "../../lib/api-keys/creation";
import { confirmProviderKeyRevocation } from "../../lib/api-keys/revocation";
import {
  parseCustomerKeyCreateInput,
  parseCustomerKeyUpdateInput,
} from "../../lib/api-keys/validation";

afterEach(() => vi.restoreAllMocks());

describe("provider-hidden key lifecycle", () => {
  it("returns only a safe display value for a one-time raw secret", () => {
    const raw = "tg_pub_this-is-the-only-secret-copy";
    const display = maskRawKey(raw);
    expect(display).toBe("tg_pub_t…copy");
    expect(display).not.toContain("this-is-the-only-secret");
  });

  it("accepts unlimited creation and exact revision-based finite edits", () => {
    expect(
      parseCustomerKeyCreateInput({ name: "Client", limitUsd: null, windowDays: null }),
    ).toEqual({ name: "Client", limitUsd: null, windowDays: null });
    expect(
      parseCustomerKeyUpdateInput({ expectedRevision: 7, limitUsd: "5", windowDays: 13 }),
    ).toEqual({ expectedRevision: 7, limitUsd: "5", windowDays: 13 });
    expect(
      parseCustomerKeyUpdateInput({ expectedRevision: 8, limitUsd: null, windowDays: null }),
    ).toEqual({ expectedRevision: 8, limitUsd: null, windowDays: null });
  });

  it.each([
    { expectedRevision: 1 },
    { expectedRevision: 1, limitUsd: "5" },
    { expectedRevision: 1, windowDays: 7 },
    { expectedRevision: 0, limitUsd: "5", windowDays: 7 },
    { expectedRevision: 1, limitUsd: "5", windowDays: null },
    { expectedRevision: 1, limitUsd: null, windowDays: 7 },
    { expectedRevision: 1, limitUsd: 5, windowDays: 7 },
    { expectedRevision: 1, limitUsd: "5.0", windowDays: 7 },
    { expectedRevision: 1, limitUsd: "5", windowDays: 31 },
  ])("rejects a stale-shaped or noncanonical allowance mutation: %#", (body) => {
    expect(() => parseCustomerKeyUpdateInput(body)).toThrow();
  });

  it.each([null, { enabled: false }])(
    "confirms fail-closed soft revocation only for a non-usable provider key: %#",
    async (observed) => {
      const provider = {
        deleteKey: vi.fn(async () => undefined),
        getKey: vi.fn(async () => observed),
      };
      await expect(
        confirmProviderKeyRevocation("provider_key", provider as never),
      ).resolves.toEqual({ status: "revoked", retryable: false });
      expect(provider.deleteKey).toHaveBeenCalledBefore(provider.getKey);
    },
  );

  it.each([
    { observed: { enabled: true }, rejectDelete: false, rejectRead: false },
    { observed: null, rejectDelete: true, rejectRead: false },
    { observed: null, rejectDelete: false, rejectRead: true },
  ])("retains a retryable locally denied state while revocation is uncertain: %#", async (input) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const provider = {
      deleteKey: vi.fn(async () => {
        if (input.rejectDelete) throw new Error("delete unavailable");
      }),
      getKey: vi.fn(async () => {
        if (input.rejectRead) throw new Error("read unavailable");
        return input.observed;
      }),
    };
    await expect(
      confirmProviderKeyRevocation("provider_key", provider as never),
    ).resolves.toEqual({ status: "revocation_pending", retryable: true });
  });
});
