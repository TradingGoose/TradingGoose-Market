import { marketApiKeys, marketUsageOwner, systemAdmin, user } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  acquireAdminGrantLocks,
  acquireApiKeyLock,
  acquireBillingSubjectLock,
  withBoundedLockAcquisition,
} from "@/lib/db/locks";
import type { ApiKeyRevocationOutcome } from "@/lib/account/contracts";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { ApiKeyNotFoundError } from "./service";

const REVOKED_OUTCOME = {
  status: "revoked",
  retryable: false,
} as const satisfies ApiKeyRevocationOutcome;
const REVOCATION_PENDING_OUTCOME = {
  status: "revocation_pending",
  retryable: true,
} as const satisfies ApiKeyRevocationOutcome;

export function revokeCustomerApiKey(userId: string, keyId: string) {
  return revokeApiKey(keyId, { userId });
}

export async function revokeAdminApiKey(keyId: string, callerGrantId: string) {
  const [target] = await requireDatabase()
    .select({ adminGrantId: marketApiKeys.adminGrantId })
    .from(marketApiKeys)
    .where(and(eq(marketApiKeys.id, keyId), eq(marketApiKeys.keyClass, "private")))
    .limit(1);
  if (!target?.adminGrantId) throw new ApiKeyNotFoundError("API key was not found");
  return revokeApiKey(keyId, { callerGrantId, targetGrantId: target.adminGrantId });
}

type Revoker = { userId: string } | { callerGrantId: string; targetGrantId: string };

async function revokeApiKey(keyId: string, caller: Revoker) {
  const database = requireDatabase();
  function locked<T>(phase: "deny" | "confirm", work: (tx: MarketTransaction) => Promise<T>) {
    return database.transaction(async (tx) => {
      await withBoundedLockAcquisition(tx, async () => {
        if ("callerGrantId" in caller) await acquireAdminGrantLocks(tx, [caller.callerGrantId, caller.targetGrantId]);
        else if (phase === "deny") await acquireBillingSubjectLock(tx, caller.userId);
        await acquireApiKeyLock(tx, keyId);
      });
      return work(tx);
    });
  }

  const local = await locked("deny", async (tx) => {
    const key = await loadAuthorizedKey(tx, keyId, caller);
    if (!key.revocationRequestedAt) {
      const [requested] = await tx
        .update(marketApiKeys)
        .set({ revocationRequestedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(marketApiKeys.id, keyId), eq(marketApiKeys.unkeyKeyId, key.unkeyKeyId)))
        .returning({ id: marketApiKeys.id });
      if (!requested) throw new Error("API key revocation state changed");
    }
    return key;
  });

  if (local.providerRevokedAt) return REVOKED_OUTCOME;
  try {
    return await locked("confirm", (tx) => confirmMappedKeyRevocation(tx, local));
  } catch (error) {
    console.error("API key provider revocation confirmation could not be saved", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return REVOCATION_PENDING_OUTCOME;
  }
}

async function loadAuthorizedKey(tx: MarketTransaction, keyId: string, caller: Revoker) {
  if ("userId" in caller) {
    const [row] = await tx
      .select({ key: marketApiKeys, emailVerified: user.emailVerified })
      .from(marketApiKeys)
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
      .innerJoin(user, eq(user.id, marketUsageOwner.userId))
      .where(
        and(
          eq(marketApiKeys.id, keyId),
          eq(marketApiKeys.keyClass, "public"),
          eq(marketApiKeys.userId, caller.userId),
          eq(user.id, caller.userId),
        ),
      )
      .for("update", { of: user })
      .limit(1);
    if (!row || (!row.emailVerified && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled)) {
      throw new ApiKeyNotFoundError("API key was not found");
    }
    return row.key;
  }

  const [admin] = await tx
    .select({ emailVerified: user.emailVerified })
    .from(systemAdmin)
    .innerJoin(user, eq(user.id, systemAdmin.userId))
    .where(and(eq(systemAdmin.id, caller.callerGrantId), eq(systemAdmin.status, "active")))
    .for("update", { of: user })
    .limit(1);
  if (!admin || (!admin.emailVerified && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled)) {
    throw new ApiKeyNotFoundError("API key was not found");
  }
  const [target] = await tx
    .select()
    .from(marketApiKeys)
    .where(
      and(
        eq(marketApiKeys.id, keyId),
        eq(marketApiKeys.keyClass, "private"),
        eq(marketApiKeys.adminGrantId, caller.targetGrantId),
      ),
    )
    .for("update")
    .limit(1);
  if (!target) throw new ApiKeyNotFoundError("API key was not found");
  return target;
}

export async function confirmMappedKeyRevocation(
  tx: MarketTransaction,
  key: Pick<typeof marketApiKeys.$inferSelect, "id" | "unkeyKeyId" | "adminGrantId" | "keyClass" | "userId" | "usageOwnerId">,
): Promise<ApiKeyRevocationOutcome> {
  const t = marketApiKeys;
  const deniedBinding = and(
    eq(t.id, key.id),
    eq(t.unkeyKeyId, key.unkeyKeyId),
    eq(t.usageOwnerId, key.usageOwnerId),
    key.userId === null ? isNull(t.userId) : eq(t.userId, key.userId),
    eq(t.keyClass, key.keyClass),
    key.adminGrantId === null ? isNull(t.adminGrantId) : eq(t.adminGrantId, key.adminGrantId),
    isNotNull(t.revocationRequestedAt),
  );
  const [current] = await tx
    .select({ providerRevokedAt: t.providerRevokedAt })
    .from(t)
    .where(deniedBinding)
    .for("update")
    .limit(1);
  if (!current) return REVOCATION_PENDING_OUTCOME;
  if (current.providerRevokedAt) return REVOKED_OUTCOME;
  const outcome = await confirmProviderKeyRevocation(key.unkeyKeyId);
  if (outcome.retryable) return outcome;
  const [updated] = await tx
    .update(t)
    .set({ providerRevokedAt: new Date(), updatedAt: new Date() })
    .where(deniedBinding)
    .returning({ id: t.id });
  return updated ? REVOKED_OUTCOME : REVOCATION_PENDING_OUTCOME;
}

export async function confirmProviderKeyRevocation(
  providerKeyId: string,
  provider: Pick<ReturnType<typeof getMarketKeyProvider>, "deleteKey" | "getKey"> = getMarketKeyProvider(),
): Promise<ApiKeyRevocationOutcome> {
  try {
    await provider.deleteKey(providerKeyId);
    const observed = await provider.getKey(providerKeyId);
    return observed === null || observed.enabled === false ? REVOKED_OUTCOME : REVOCATION_PENDING_OUTCOME;
  } catch (error) {
    console.error("API key provider revocation remains pending", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return REVOCATION_PENDING_OUTCOME;
  }
}
