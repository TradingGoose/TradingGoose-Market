import { describe, expect, it, vi } from "vitest";

import type { UnkeyAdapter } from "../../lib/unkey/client";
import {
  deleteAndConfirmProvisioningCandidates,
  findProvisioningCandidates,
  isProvisioningCandidate,
} from "../../lib/unkey/provisioning";

describe("one-time key provisioning cleanup", () => {
  it("correlates only the exact non-sensitive Market attempt metadata", () => {
    expect(
      isProvisioningCandidate(
        { keyId: "key_1", meta: { marketCorrelationId: "attempt_1" } } as never,
        "attempt_1",
      ),
    ).toBe(true);
    expect(
      isProvisioningCandidate(
        { keyId: "key_2", meta: { marketCorrelationId: "attempt_10" } } as never,
        "attempt_1",
      ),
    ).toBe(false);
    expect(
      isProvisioningCandidate(
        { keyId: "key_3", meta: { userId: "attempt_1" } } as never,
        "attempt_1",
      ),
    ).toBe(false);
  });

  it("exhaustively deletes every correlated candidate and proves zero enabled keys", async () => {
    const state = new Map([
      ["key_1", { keyId: "key_1", enabled: true, meta: { marketCorrelationId: "attempt_1" } }],
      ["key_2", { keyId: "key_2", enabled: true, meta: { marketCorrelationId: "attempt_1" } }],
      ["key_other", { keyId: "key_other", enabled: true, meta: { marketCorrelationId: "other" } }],
    ]);
    const listKeys = vi.fn(async () => [...state.values()]);
    const deleteKey = vi.fn(async (keyId: string) => {
      const current = state.get(keyId);
      if (current) state.set(keyId, { ...current, enabled: false });
    });
    const adapter = { listKeys, deleteKey } as unknown as UnkeyAdapter;

    await expect(
      deleteAndConfirmProvisioningCandidates(adapter, "attempt_1"),
    ).resolves.toBeUndefined();

    expect(deleteKey.mock.calls.map(([id]) => id).sort()).toEqual(["key_1", "key_2"]);
    expect(listKeys).toHaveBeenCalledTimes(2);
    await expect(findProvisioningCandidates(adapter, "attempt_1")).resolves.toEqual([
      expect.objectContaining({ keyId: "key_1", enabled: false }),
      expect.objectContaining({ keyId: "key_2", enabled: false }),
    ]);
    expect(state.get("key_other")?.enabled).toBe(true);
  });

  it("keeps creation blocked when provider non-usability cannot be proven", async () => {
    const candidate = {
      keyId: "key_unknown",
      enabled: true,
      meta: { marketCorrelationId: "attempt_unknown" },
    };
    const adapter = {
      listKeys: vi.fn(async () => [candidate]),
      deleteKey: vi.fn(async () => undefined),
    } as unknown as UnkeyAdapter;

    await expect(
      deleteAndConfirmProvisioningCandidates(adapter, "attempt_unknown"),
    ).rejects.toThrow(/cleanup is not yet confirmed/);
    expect(adapter.deleteKey).toHaveBeenCalledWith("key_unknown");
  });
});
