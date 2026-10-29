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
) {
  const candidates = await findProvisioningCandidates(adapter, correlationId);
  await Promise.all(candidates.map((candidate) => adapter.deleteKey(candidate.keyId)));
  const remaining = (await findProvisioningCandidates(adapter, correlationId)).filter(
    (candidate) => candidate.enabled,
  );
  if (remaining.length > 0) {
    throw new Error("Key provider cleanup is not yet confirmed");
  }
}
