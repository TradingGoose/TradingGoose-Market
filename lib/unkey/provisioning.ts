import type { KeyResponseData } from "@unkey/api/models/components";
import type { UnkeyAdapter } from "./client";

export function isProvisioningCandidate(
  key: KeyResponseData,
  correlationId: string,
) {
  return key.meta?.marketCorrelationId === correlationId;
}

export async function findProvisioningCandidates(
  adapter: UnkeyAdapter,
  correlationId: string,
) {
  return (await adapter.listKeys()).filter((key) =>
    isProvisioningCandidate(key, correlationId),
  );
}

export async function deleteAndConfirmProvisioningCandidates(
  adapter: UnkeyAdapter,
  correlationId: string,
  knownKeyId?: string,
) {
  if (knownKeyId) await adapter.deleteKey(knownKeyId);
  const candidates = await findProvisioningCandidates(adapter, correlationId);
  await Promise.all(candidates.filter((key) => key.keyId !== knownKeyId)
    .map((key) => adapter.deleteKey(key.keyId)));
  if (knownKeyId && (await adapter.getKey(knownKeyId))?.enabled) {
    throw new Error("Known provisioning key revocation is not confirmed");
  }
  const remaining = await findProvisioningCandidates(adapter, correlationId);
  if (remaining.some((candidate) => candidate.enabled)) {
    throw new Error("Key provider cleanup is not yet confirmed");
  }
}
