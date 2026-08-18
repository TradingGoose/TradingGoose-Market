import {
  marketApiKeys,
  marketUsageOwner,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  acquireAdminGrantLocks,
  acquireApiKeyLock,
  withAdminGrantAndApiKeyHandlerLocks,
} from "@/lib/db/locks";
import type { ApiKeyRevocationOutcome } from "@/lib/account/contracts";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";
import { ApiKeyNotFoundError } from "./service";

const REVOKED_OUTCOME = {
  status: "revoked",
  retryable: false,
} as const satisfies ApiKeyRevocationOutcome;
const REVOCATION_PENDING_OUTCOME = {
  status: "revocation_pending",
  retryable: true,
} as const satisfies ApiKeyRevocationOutcome;

export async function revokeCustomerApiKey(userId: string, keyId: string) {
  return revokeApiKey({ keyId, ownerUserId: userId, expectedClass: "public" });
}

export async function revokeAdminApiKey(keyId: string, callerGrantId: string) {
  const database = requireDatabase();
  const targetRows = await database
    .select({ adminGrantId: marketApiKeys.adminGrantId })
    .from(marketApiKeys)
    .where(
      and(eq(marketApiKeys.id, keyId), eq(marketApiKeys.keyClass, "private")),
    )
    .limit(1);
  const targetGrantId = targetRows[0]?.adminGrantId;
  if (!targetGrantId) throw new ApiKeyNotFoundError("API key was not found");
  return withAdminGrantAndApiKeyHandlerLocks(
    [callerGrantId, targetGrantId],
    keyId,
    async (lockedDatabase) => {
      const local = await lockedDatabase.transaction(async (tx) => {
        await acquireAdminGrantLocks(tx, [callerGrantId, targetGrantId]);
        await acquireApiKeyLock(tx, keyId);
        const callerRows = await tx
          .select({
            id: systemAdmin.id,
            emailVerified: user.emailVerified,
          })
          .from(systemAdmin)
          .innerJoin(user, eq(user.id, systemAdmin.userId))
          .where(
            and(
              eq(systemAdmin.id, callerGrantId),
              eq(systemAdmin.status, "active"),
            ),
          )
          .for("update")
          .limit(2);
        if (
          callerRows.length !== 1 ||
          callerRows[0]?.emailVerified !== true
        ) {
          throw new ApiKeyNotFoundError("API key was not found");
        }
        const keyRows = await tx
          .select({
            providerId: marketApiKeys.unkeyKeyId,
            providerRevokedAt: marketApiKeys.providerRevokedAt,
            revocationRequestedAt: marketApiKeys.revocationRequestedAt,
            usageOwnerId: marketUsageOwner.id,
          })
          .from(marketApiKeys)
          .innerJoin(
            marketUsageOwner,
            eq(marketUsageOwner.id, marketApiKeys.usageOwnerId),
          )
          .where(
            and(
              eq(marketApiKeys.id, keyId),
              eq(marketApiKeys.keyClass, "private"),
              eq(marketApiKeys.adminGrantId, targetGrantId),
            ),
          )
          .for("update")
          .limit(2);
        const key = keyRows[0];
        if (keyRows.length !== 1 || !key) {
          throw new ApiKeyNotFoundError("API key was not found");
        }
        if (!key.revocationRequestedAt) {
          const requested = await tx
            .update(marketApiKeys)
            .set({ revocationRequestedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(marketApiKeys.id, keyId),
                eq(marketApiKeys.unkeyKeyId, key.providerId),
                eq(marketApiKeys.adminGrantId, targetGrantId),
              ),
            )
            .returning({ id: marketApiKeys.id });
          if (requested.length !== 1) {
            throw new Error("API key revocation state changed");
          }
        }
        return key;
      });

      if (local.providerRevokedAt) return REVOKED_OUTCOME;
      const providerOutcome = await confirmProviderKeyRevocation(local.providerId);
      if (providerOutcome.status === "revocation_pending") return providerOutcome;
      try {
        const finalized = await lockedDatabase.transaction(async (tx) => {
          await acquireAdminGrantLocks(tx, [callerGrantId, targetGrantId]);
          await acquireApiKeyLock(tx, keyId);
          const updated = await tx
            .update(marketApiKeys)
            .set({ providerRevokedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(marketApiKeys.id, keyId),
                eq(marketApiKeys.unkeyKeyId, local.providerId),
                eq(marketApiKeys.adminGrantId, targetGrantId),
                isNotNull(marketApiKeys.revocationRequestedAt),
              ),
            )
            .returning({ id: marketApiKeys.id });
          return updated.length === 1;
        });
        return finalized ? REVOKED_OUTCOME : REVOCATION_PENDING_OUTCOME;
      } catch (error) {
        console.error("API key provider revocation confirmation could not be saved", {
          errorClass: error instanceof Error ? error.name : "UnknownError",
        });
        return REVOCATION_PENDING_OUTCOME;
      }
    },
  );
}

async function revokeApiKey(input: {
  keyId: string;
  ownerUserId: string | null;
  expectedClass: "public" | "private";
}) {
  const database = requireDatabase();
  const local = await database.transaction(async (tx) => {
    await acquireApiKeyLock(tx, input.keyId);
    const rows = await tx
      .select({
        key: marketApiKeys,
        ownerUserId: marketUsageOwner.userId,
        activeUserId: user.id,
        emailVerified: user.emailVerified,
      })
      .from(marketApiKeys)
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeys.usageOwnerId))
      .innerJoin(user, eq(user.id, marketUsageOwner.userId))
      .where(
        and(
          eq(marketApiKeys.id, input.keyId),
          eq(marketApiKeys.keyClass, input.expectedClass),
        ),
      )
      .for("update")
      .limit(1);
    const row = rows[0];
    if (
      !row ||
      row.emailVerified !== true ||
      !row.key.userId ||
      row.key.userId !== row.ownerUserId ||
      row.activeUserId !== row.ownerUserId ||
      (input.ownerUserId !== null && row.ownerUserId !== input.ownerUserId)
    ) {
      throw new ApiKeyNotFoundError("API key was not found");
    }
    if (!row.key.revocationRequestedAt) {
      await tx
        .update(marketApiKeys)
        .set({ revocationRequestedAt: new Date(), updatedAt: new Date() })
        .where(eq(marketApiKeys.id, input.keyId));
    }
    return {
      providerKeyId: row.key.unkeyKeyId,
      providerRevokedAt: row.key.providerRevokedAt,
    };
  });

  if (local.providerRevokedAt) return REVOKED_OUTCOME;
  const providerOutcome = await confirmProviderKeyRevocation(local.providerKeyId);
  if (providerOutcome.status === "revocation_pending") return providerOutcome;
  return finalizeProviderRevocation(input.keyId, local.providerKeyId);
}

export async function confirmProviderKeyRevocation(
  providerKeyId: string,
  provider: Pick<ReturnType<typeof getMarketKeyProvider>, "deleteKey" | "getKey"> =
    getMarketKeyProvider(),
): Promise<ApiKeyRevocationOutcome> {
  try {
    await provider.deleteKey(providerKeyId);
    const observed = await provider.getKey(providerKeyId);
    return observed === null || observed.enabled === false
      ? REVOKED_OUTCOME
      : REVOCATION_PENDING_OUTCOME;
  } catch (error) {
    console.error("API key provider revocation remains pending", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return REVOCATION_PENDING_OUTCOME;
  }
}

async function finalizeProviderRevocation(
  keyId: string,
  providerKeyId: string,
): Promise<ApiKeyRevocationOutcome> {
  const database = requireDatabase();
  try {
    const finalized = await database.transaction(async (tx) => {
      await acquireApiKeyLock(tx, keyId);
      const updated = await tx
        .update(marketApiKeys)
        .set({ providerRevokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(marketApiKeys.id, keyId),
            eq(marketApiKeys.unkeyKeyId, providerKeyId),
            isNotNull(marketApiKeys.revocationRequestedAt),
          ),
        )
        .returning({ id: marketApiKeys.id });
      return updated.length === 1;
    });
    return finalized ? REVOKED_OUTCOME : REVOCATION_PENDING_OUTCOME;
  } catch (error) {
    console.error("API key provider revocation confirmation could not be saved", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return REVOCATION_PENDING_OUTCOME;
  }
}
