import {
  marketApiKeyCreationAttempts,
  marketApiKeys,
  marketUsageOwner,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { MarketTransaction } from "@tradinggoose/db";
import {
  acquireApiKeyLock,
  acquireAdminGrantLock,
  acquireBillingSubjectLock,
  withBoundedLockAcquisition,
} from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { deleteAndConfirmProvisioningCandidates } from "@/lib/unkey/provisioning";
import type { CreatedProviderKey } from "@/lib/unkey/client";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";
import type { CustomerKeyAllowance } from "./validation";

export type ApiKeyClass = "public" | "private";

export class ApiKeyCreationConflict extends Error {
  override readonly name = "ApiKeyCreationConflict";
}

type Attempt = typeof marketApiKeyCreationAttempts.$inferSelect;
type CreationInput = {
  userId: string;
  name: string;
  allowance: CustomerKeyAllowance;
} & ({ keyClass: "public"; adminGrantId: null } | { keyClass: "private"; adminGrantId: string });

export function createCustomerApiKey(input: {
  userId: string;
  name: string;
  allowance: CustomerKeyAllowance;
}) {
  return createApiKey({ ...input, keyClass: "public", adminGrantId: null });
}

export function createAdminApiKey(input: { userId: string; adminGrantId: string; name: string }) {
  return createApiKey({
    ...input,
    keyClass: "private",
    allowance: { limitUsd: null, windowDays: null },
  });
}

async function createApiKey(input: CreationInput) {
  const database = requireDatabase();
  function locked<T>(keyId: string | null, work: (tx: MarketTransaction) => Promise<T>) {
    return database.transaction(async (tx) => {
      await withBoundedLockAcquisition(tx, async () => {
        if (input.keyClass === "public") await acquireBillingSubjectLock(tx, input.userId);
        else await acquireAdminGrantLock(tx, input.adminGrantId);
        if (keyId) await acquireApiKeyLock(tx, keyId);
      });
      return work(tx);
    });
  }

  const dispatch = await locked(null, async (tx) => {
    const [prior, other] = await tx
      .select({ attempt: marketApiKeyCreationAttempts })
      .from(marketApiKeyCreationAttempts)
      .innerJoin(marketUsageOwner, eq(marketUsageOwner.id, marketApiKeyCreationAttempts.usageOwnerId))
      .where(
        and(
          eq(marketUsageOwner.userId, input.userId),
          eq(marketApiKeyCreationAttempts.keyClass, input.keyClass),
        ),
      )
      .limit(2);
    if (other) throw new Error("Key creation attempt state is ambiguous");
    const reservedKeyId = prior?.attempt.reservedKeyId ?? crypto.randomUUID();
    await withBoundedLockAcquisition(tx, () => acquireApiKeyLock(tx, reservedKeyId));
    const usageOwnerId = await assertCreationAdmission(tx, input);

    if (prior) {
      const attempt = prior.attempt;
      if (
        attempt.userId !== input.userId ||
        attempt.usageOwnerId !== usageOwnerId ||
        attempt.adminGrantId !== input.adminGrantId ||
        attempt.keyClass !== input.keyClass
      ) {
        throw new ApiKeyCreationConflict("A prior key creation belongs to a different owner or grant");
      }
      return { cleanup: await reconcileCreationAttempt(tx, attempt) } as const;
    }

    const [attempt] = await tx
      .insert(marketApiKeyCreationAttempts)
      .values({
        userId: input.userId,
        usageOwnerId,
        reservedKeyId,
        correlationId: crypto.randomUUID(),
        adminGrantId: input.adminGrantId,
        keyClass: input.keyClass,
        name: input.name,
        spendLimitUsd: input.allowance.limitUsd,
        spendWindowDays: input.allowance.windowDays,
        state: "dispatched",
        dispatchedAt: new Date(),
      })
      .returning();
    if (!attempt) throw new Error("Key creation attempt could not be recorded");
    return { attempt } as const;
  });
  if ("cleanup" in dispatch) {
    if (dispatch.cleanup) throw dispatch.cleanup.error;
    throw new ApiKeyCreationConflict("A prior key creation was reconciled. Submit a fresh create request.");
  }

  const { attempt } = dispatch;
  const provider = getMarketKeyProvider();
  const issued: { key?: CreatedProviderKey } = {};
  const finalizedAt = new Date();
  try {
    await locked(attempt.reservedKeyId, async (tx) => {
      await assertDispatch(tx, input, attempt, null);
      const created = await provider.createKey({
        name: attempt.name,
        permission: input.keyClass === "public" ? "market.public" : "market.private",
        correlationId: attempt.correlationId,
      });
      issued.key = created;
      const projected = await tx
        .update(marketApiKeyCreationAttempts)
        .set({
          providerKeyId: created.keyId,
          providerDisplayValue: maskRawKey(created.key),
          updatedAt: new Date(),
        })
        .where(dispatchPredicate(attempt, null))
        .returning({ id: marketApiKeyCreationAttempts.id });
      if (!projected[0]) throw new Error("Key creation provider result could not be projected");
    });

    const created = issued.key!;
    await locked(attempt.reservedKeyId, async (tx) => {
      await assertDispatch(tx, input, attempt, created);
      await provider.enableKey(created.keyId);
      await tx.insert(marketApiKeys).values({
        id: attempt.reservedKeyId,
        usageOwnerId: attempt.usageOwnerId,
        userId: input.userId,
        unkeyKeyId: created.keyId,
        adminGrantId: input.adminGrantId,
        keyClass: input.keyClass,
        name: attempt.name,
        displayValue: maskRawKey(created.key),
        spendLimitUsd: attempt.spendLimitUsd,
        spendWindowDays: attempt.spendWindowDays,
        spendLimitRevision: input.keyClass === "public" ? 1 : null,
        spendLimitUpdatedAt: input.keyClass === "public" ? finalizedAt : null,
        createdAt: finalizedAt,
        updatedAt: finalizedAt,
      });
      const deleted = await tx
        .delete(marketApiKeyCreationAttempts)
        .where(dispatchPredicate(attempt, created))
        .returning({ id: marketApiKeyCreationAttempts.id });
      if (!deleted[0]) throw new Error("Key creation attempt could not be deleted after finalization");
    });
  } catch (error) {
    // COMMIT can succeed before its reply is lost. Preserve any committed mapping.
    const canReveal = await locked(attempt.reservedKeyId, async (tx) => {
      const [mapping] = await tx
        .select()
        .from(marketApiKeys)
        .where(eq(marketApiKeys.id, attempt.reservedKeyId))
        .limit(1);
      const [current] = await tx
        .select()
        .from(marketApiKeyCreationAttempts)
        .where(attemptPredicate(attempt))
        .for("update")
        .limit(1);
      if (mapping) {
        return (
          !current &&
          mapping.unkeyKeyId === issued.key?.keyId &&
          mapping.usageOwnerId === attempt.usageOwnerId &&
          mapping.userId === input.userId &&
          mapping.keyClass === input.keyClass &&
          mapping.adminGrantId === input.adminGrantId &&
          !mapping.revocationRequestedAt &&
          !mapping.providerRevokedAt &&
          (await assertCreationAdmission(tx, input)) === attempt.usageOwnerId
        );
      }
      if (current) await reconcileCreationAttempt(tx, current, issued.key);
      return false;
    });
    if (!canReveal) throw error;
  }

  const created = issued.key!;
  const baseKey = {
    id: attempt.reservedKeyId,
    name: attempt.name,
    displayValue: maskRawKey(created.key),
    status: "available" as const,
    createdAt: finalizedAt.toISOString(),
    lastUsedAt: null,
    totalRequestCount: 0,
  };
  return {
    key:
      input.keyClass === "public"
        ? {
            ...baseKey,
            spendLimitUsd: attempt.spendLimitUsd,
            spendWindowDays: attempt.spendWindowDays,
            rollingBillableCostUsd: attempt.spendLimitUsd === null ? null : "0",
          }
        : baseKey,
    secret: created.key,
  };
}

export function maskRawKey(rawKey: string) {
  if (rawKey.length <= 12) return `${rawKey.slice(0, 4)}…`;
  return `${rawKey.slice(0, 8)}…${rawKey.slice(-4)}`;
}

function attemptPredicate(attempt: Attempt) {
  const t = marketApiKeyCreationAttempts;
  return and(
    eq(t.id, attempt.id),
    eq(t.reservedKeyId, attempt.reservedKeyId),
    eq(t.correlationId, attempt.correlationId),
    eq(t.usageOwnerId, attempt.usageOwnerId),
    attempt.userId === null ? isNull(t.userId) : eq(t.userId, attempt.userId),
    attempt.adminGrantId === null ? isNull(t.adminGrantId) : eq(t.adminGrantId, attempt.adminGrantId),
    eq(t.keyClass, attempt.keyClass),
  );
}

function dispatchPredicate(attempt: Attempt, created: CreatedProviderKey | null) {
  const t = marketApiKeyCreationAttempts;
  return and(
    attemptPredicate(attempt),
    eq(t.state, "dispatched"),
    created ? eq(t.providerKeyId, created.keyId) : isNull(t.providerKeyId),
    created ? eq(t.providerDisplayValue, maskRawKey(created.key)) : isNull(t.providerDisplayValue),
  );
}

async function assertDispatch(
  tx: MarketTransaction,
  input: CreationInput,
  attempt: Attempt,
  created: CreatedProviderKey | null,
) {
  const ownerId = await assertCreationAdmission(tx, input);
  const [current] = await tx
    .select()
    .from(marketApiKeyCreationAttempts)
    .where(dispatchPredicate(attempt, created))
    .for("update")
    .limit(1);
  if (
    !current ||
    ownerId !== attempt.usageOwnerId ||
    current.name !== attempt.name ||
    current.spendWindowDays !== attempt.spendWindowDays ||
    current.spendLimitUsd !== attempt.spendLimitUsd
  ) {
    throw new ApiKeyCreationConflict("Key creation attempt changed before dispatch or activation");
  }
}

// Caller holds the owner/grant and reserved-key locks. Keep cleanup intent on provider uncertainty.
export async function reconcileCreationAttempt(
  tx: MarketTransaction,
  attempt: Attempt,
  created?: CreatedProviderKey,
) {
  const t = marketApiKeyCreationAttempts;
  const [current] = await tx.select().from(t).where(attemptPredicate(attempt)).for("update").limit(1);
  if (!current) return;
  const providerKeyId = current.providerKeyId ?? created?.keyId;
  const [marked] = await tx
    .update(t)
    .set({
      state: "cleanup_required",
      ...(created && !current.providerKeyId
        ? { providerKeyId: created.keyId, providerDisplayValue: maskRawKey(created.key) }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(attemptPredicate(current), eq(t.state, current.state)))
    .returning({ id: t.id });
  if (!marked) throw new Error("Key creation attempt changed during reconciliation");
  try {
    await deleteAndConfirmProvisioningCandidates(
      getMarketKeyProvider(),
      current.correlationId,
      providerKeyId,
    );
  } catch (error) {
    return { error };
  }
  const deleted = await tx
    .delete(t)
    .where(and(attemptPredicate(current), eq(t.state, "cleanup_required")))
    .returning({ id: t.id });
  if (!deleted[0]) throw new Error("Reconciled key creation attempt could not be cleared");
}

async function assertCreationAdmission(tx: MarketTransaction, input: CreationInput) {
  const [owner, other] = await tx
    .select({ id: marketUsageOwner.id, emailVerified: user.emailVerified })
    .from(marketUsageOwner)
    .innerJoin(user, eq(user.id, marketUsageOwner.userId))
    .where(eq(user.id, input.userId))
    .for("update", { of: user })
    .limit(2);
  if (
    !owner ||
    other ||
    (!owner.emailVerified && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled)
  ) {
    throw new Error("Market customer state is missing or not authorized");
  }
  if (input.keyClass === "private") {
    const [grant] = await tx
      .select({ id: systemAdmin.id })
      .from(systemAdmin)
      .where(
        and(
          eq(systemAdmin.id, input.adminGrantId),
          eq(systemAdmin.userId, input.userId),
          eq(systemAdmin.status, "active"),
        ),
      )
      .for("update")
      .limit(1);
    if (!grant) throw new ApiKeyCreationConflict("Admin membership is not active");
  }
  return owner.id;
}
