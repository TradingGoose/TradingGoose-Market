import {
  marketApiKeyCreationAttempts,
  marketApiKeys,
  marketUsageOwner,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import { and, eq } from "drizzle-orm";
import type { MarketDatabase, MarketTransaction } from "@tradinggoose/db";
import {
  withAdminGrantAndApiKeyCreationHandlerLocks,
  withBillingSubjectAndApiKeyCreationHandlerLocks,
} from "@/lib/db/locks";
import {
  deleteAndConfirmProvisioningCandidates,
} from "@/lib/unkey/provisioning";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";
import type { CustomerKeyAllowance } from "./validation";

export type ApiKeyClass = "public" | "private";

export class ApiKeyCreationConflict extends Error {
  override readonly name = "ApiKeyCreationConflict";
}

type LockedCreationAttemptIdentity = {
  attemptId: string;
  reservedKeyId: string;
  correlationId: string;
};

export async function createCustomerApiKey(input: {
  userId: string;
  name: string;
  allowance: CustomerKeyAllowance;
}) {
  return withBillingSubjectAndApiKeyCreationHandlerLocks(
    input.userId,
    async (database, acquireApiKeySessionLock) => {
      const usageOwnerId = await loadCanonicalCreationState(database, {
        userId: input.userId,
        keyClass: "public",
        adminGrantId: null,
      });
      return createApiKey({
        userId: input.userId,
        usageOwnerId,
        keyClass: "public",
        adminGrantId: null,
        name: input.name,
        allowance: input.allowance,
        database,
        acquireApiKeySessionLock,
      });
    },
  );
}

export async function createAdminApiKey(input: {
  userId: string;
  adminGrantId: string;
  name: string;
}) {
  return withAdminGrantAndApiKeyCreationHandlerLocks(
    input.adminGrantId,
    async (database, acquireApiKeySessionLock) => {
      const usageOwnerId = await loadCanonicalCreationState(database, {
        userId: input.userId,
        keyClass: "private",
        adminGrantId: input.adminGrantId,
      });
      return createApiKey({
        userId: input.userId,
        usageOwnerId,
        keyClass: "private",
        adminGrantId: input.adminGrantId,
        name: input.name,
        allowance: { limitUsd: null, windowDays: null },
        database,
        acquireApiKeySessionLock,
      });
    },
  );
}

async function loadCanonicalCreationState(
  database: MarketDatabase,
  input: {
    userId: string;
    keyClass: ApiKeyClass;
    adminGrantId: string | null;
  },
) {
  if (input.keyClass === "private" && !input.adminGrantId) {
    throw new Error("Admin grant is required");
  }
  const ownerRows = await database
    .select({
      ownerId: marketUsageOwner.id,
      ownerUserId: marketUsageOwner.userId,
      activeUserId: user.id,
      emailVerified: user.emailVerified,
    })
    .from(marketUsageOwner)
    .innerJoin(user, eq(user.id, marketUsageOwner.userId))
    .where(
      and(
        eq(marketUsageOwner.userId, input.userId),
        eq(user.id, input.userId),
      ),
    )
    .limit(2);
  const owner = ownerRows[0];
  if (
    ownerRows.length !== 1 ||
    !owner ||
    owner.ownerUserId !== input.userId ||
    owner.activeUserId !== input.userId ||
    owner.emailVerified !== true
  ) {
    throw new Error("Verified Market customer state is missing");
  }

  if (input.keyClass === "private") {
    const grantRows = await database
      .select({ id: systemAdmin.id })
      .from(systemAdmin)
      .where(
        and(
          eq(systemAdmin.id, input.adminGrantId!),
          eq(systemAdmin.userId, input.userId),
          eq(systemAdmin.status, "active"),
        ),
      )
      .limit(2);
    if (grantRows.length !== 1) {
      throw new ApiKeyCreationConflict("Admin membership is not active");
    }
  }
  return owner.ownerId;
}

async function createApiKey(input: {
  userId: string;
  usageOwnerId: string;
  keyClass: ApiKeyClass;
  adminGrantId: string | null;
  name: string;
  allowance: CustomerKeyAllowance;
  database: MarketDatabase;
  acquireApiKeySessionLock: (keyId: string) => Promise<void>;
}) {
  const database = input.database;
  const priorRows = await database
    .select()
    .from(marketApiKeyCreationAttempts)
    .where(
      and(
        eq(marketApiKeyCreationAttempts.usageOwnerId, input.usageOwnerId),
        eq(marketApiKeyCreationAttempts.keyClass, input.keyClass),
      ),
    )
    .limit(2);
  if (priorRows.length > 1) {
    throw new Error("Key creation attempt state is ambiguous");
  }
  const observedPrior = priorRows[0];
  const reservedKeyId = observedPrior?.reservedKeyId ?? crypto.randomUUID();
  await input.acquireApiKeySessionLock(reservedKeyId);

  const correlationId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();

  const attempt = await database.transaction(async (tx) => {
    await assertCreationAdmission(tx, input);

    const unresolved = await tx
      .select()
      .from(marketApiKeyCreationAttempts)
      .where(
        and(
          eq(marketApiKeyCreationAttempts.usageOwnerId, input.usageOwnerId),
          eq(marketApiKeyCreationAttempts.keyClass, input.keyClass),
        ),
      )
      .for("update")
      .limit(2);
    if (unresolved.length > 1) {
      throw new Error("Key creation attempt state is ambiguous");
    }
    const prior = unresolved[0];
    if (observedPrior) {
      if (
        !prior ||
        prior.id !== observedPrior.id ||
        prior.reservedKeyId !== reservedKeyId ||
        prior.correlationId !== observedPrior.correlationId ||
        prior.usageOwnerId !== input.usageOwnerId ||
        prior.userId !== input.userId ||
        prior.keyClass !== input.keyClass
      ) {
        throw new Error("Key creation attempt changed before its local-key lock was acquired");
      }
      if (
        input.keyClass === "private" &&
        prior.adminGrantId !== input.adminGrantId
      ) {
        throw new ApiKeyCreationConflict(
          "A prior key creation belongs to a different admin grant",
        );
      }
      return { prior } as const;
    }
    if (prior) {
      throw new Error("A key creation attempt appeared before reservation");
    }

    await tx.insert(marketApiKeyCreationAttempts).values({
      id: attemptId,
      reservedKeyId,
      usageOwnerId: input.usageOwnerId,
      userId: input.userId,
      adminGrantId: input.adminGrantId,
      keyClass: input.keyClass,
      name: input.name,
      spendLimitUsd: input.allowance.limitUsd,
      spendWindowDays: input.allowance.windowDays,
      correlationId,
      state: "reserved",
    });
    return { usageOwnerId: input.usageOwnerId } as const;
  });

  if ("prior" in attempt && attempt.prior) {
    await reconcilePriorCreationAttempt(database, attempt.prior, reservedKeyId);
    throw new ApiKeyCreationConflict(
      "A prior key creation was reconciled. Submit a fresh create request.",
    );
  }

  const lockedAttempt = {
    attemptId,
    reservedKeyId,
    correlationId,
  };

  const dispatched = await database
    .update(marketApiKeyCreationAttempts)
    .set({ state: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        lockedAttemptPredicate(lockedAttempt),
        eq(marketApiKeyCreationAttempts.state, "reserved"),
      ),
    )
    .returning({ id: marketApiKeyCreationAttempts.id });
  if (!dispatched[0]) {
    throw new Error("Key creation reservation could not be dispatched");
  }

  const provider = getMarketKeyProvider();
  let created: { keyId: string; key: string };
  const finalizedAt = new Date();
  try {
    created = await provider.createKey({
      name: input.name,
      permission: input.keyClass === "public" ? "market.public" : "market.private",
      correlationId,
    });
  } catch (error) {
    await cleanupCreationAttempt(database, provider, lockedAttempt);
    throw error;
  }

  const displayValue = maskRawKey(created.key);
  try {
    const projected = await database
      .update(marketApiKeyCreationAttempts)
      .set({
        providerKeyId: created.keyId,
        providerDisplayValue: displayValue,
        updatedAt: new Date(),
      })
      .where(
        and(
          lockedAttemptPredicate(lockedAttempt),
          eq(marketApiKeyCreationAttempts.state, "dispatched"),
        ),
      )
      .returning({ id: marketApiKeyCreationAttempts.id });
    if (!projected[0]) {
      throw new Error("Key creation provider result could not be projected");
    }
  } catch (error) {
    await cleanupKnownCreationResult(database, {
      ...lockedAttempt,
      providerKeyId: created.keyId,
      providerDisplayValue: displayValue,
    });
    throw error;
  }

  try {
    await database.transaction(async (tx) => {
      await assertCreationAdmission(tx, input);
      const attemptRows = await tx
        .select()
        .from(marketApiKeyCreationAttempts)
        .where(lockedAttemptPredicate(lockedAttempt))
        .for("update")
        .limit(1);
      const current = attemptRows[0];
      if (
        !current ||
        current.usageOwnerId !== input.usageOwnerId ||
        current.userId !== input.userId ||
        current.adminGrantId !== input.adminGrantId ||
        current.keyClass !== input.keyClass ||
        current.name !== input.name ||
        current.spendLimitUsd !== input.allowance.limitUsd ||
        current.spendWindowDays !== input.allowance.windowDays ||
        current.state !== "dispatched" ||
        current.providerKeyId !== created.keyId ||
        current.providerDisplayValue !== displayValue
      ) {
        throw new Error("Key creation reservation changed before finalization");
      }
      await tx.insert(marketApiKeys).values({
        id: reservedKeyId,
        usageOwnerId: attempt.usageOwnerId,
        userId: input.userId,
        unkeyKeyId: created.keyId,
        adminGrantId: input.adminGrantId,
        keyClass: input.keyClass,
        name: input.name,
        displayValue,
        spendLimitUsd: input.allowance.limitUsd,
        spendWindowDays: input.allowance.windowDays,
        spendLimitRevision: input.keyClass === "public" ? 1 : null,
        spendLimitUpdatedAt: input.keyClass === "public" ? finalizedAt : null,
        createdAt: finalizedAt,
        updatedAt: finalizedAt,
      });
      const deleted = await tx
        .delete(marketApiKeyCreationAttempts)
        .where(lockedAttemptPredicate(lockedAttempt))
        .returning({ id: marketApiKeyCreationAttempts.id });
      if (!deleted[0]) {
        throw new Error("Key creation attempt could not be deleted after finalization");
      }
    });
  } catch (error) {
    await cleanupKnownCreationResult(database, {
      ...lockedAttempt,
      providerKeyId: created.keyId,
      providerDisplayValue: displayValue,
    });
    throw error;
  }

  const baseKey = {
    id: reservedKeyId,
    name: input.name,
    displayValue,
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
            spendLimitUsd: input.allowance.limitUsd,
            spendWindowDays: input.allowance.windowDays,
            rollingBillableCostUsd:
              input.allowance.limitUsd === null ? null : "0",
          }
        : baseKey,
    secret: created.key,
  };
}

export function maskRawKey(rawKey: string) {
  if (rawKey.length <= 12) return `${rawKey.slice(0, 4)}…`;
  return `${rawKey.slice(0, 8)}…${rawKey.slice(-4)}`;
}

async function reconcilePriorCreationAttempt(
  database: MarketDatabase,
  attempt: typeof marketApiKeyCreationAttempts.$inferSelect,
  lockedReservedKeyId: string,
) {
  if (attempt.reservedKeyId !== lockedReservedKeyId) {
    throw new Error("Prior key creation attempt does not match the locked local key");
  }
  const identity = {
    attemptId: attempt.id,
    reservedKeyId: lockedReservedKeyId,
    correlationId: attempt.correlationId,
  };
  if (attempt.state === "reserved") {
    const deleted = await database
      .delete(marketApiKeyCreationAttempts)
      .where(
        and(
          lockedAttemptPredicate(identity),
          eq(marketApiKeyCreationAttempts.state, "reserved"),
        ),
      )
      .returning({ id: marketApiKeyCreationAttempts.id });
    if (!deleted[0]) {
      throw new Error("Reserved key creation attempt changed before reconciliation");
    }
    return;
  }

  const provider = getMarketKeyProvider();
  if (attempt.providerKeyId) {
    try {
      await provider.deleteKey(attempt.providerKeyId);
    } catch {
      // Exhaustive correlation cleanup below remains the non-usability proof.
    }
  }
  await deleteAndConfirmProvisioningCandidates(provider, attempt.correlationId);
  const deleted = await database
    .delete(marketApiKeyCreationAttempts)
    .where(lockedAttemptPredicate(identity))
    .returning({ id: marketApiKeyCreationAttempts.id });
  if (!deleted[0]) {
    throw new Error("Reconciled key creation attempt could not be cleared");
  }
}

async function cleanupKnownCreationResult(
  database: MarketDatabase,
  input: LockedCreationAttemptIdentity & {
    providerKeyId: string;
    providerDisplayValue: string;
  },
) {
  const provider = getMarketKeyProvider();
  await cleanupCreationAttempt(database, provider, input, {
    providerKeyId: input.providerKeyId,
    providerDisplayValue: input.providerDisplayValue,
  });
}

async function cleanupCreationAttempt(
  database: MarketDatabase,
  provider: ReturnType<typeof getMarketKeyProvider>,
  identity: LockedCreationAttemptIdentity,
  projection?: {
    providerKeyId: string;
    providerDisplayValue: string;
  },
) {
  try {
    await database
      .update(marketApiKeyCreationAttempts)
      .set({
        state: "cleanup_required",
        ...(projection ?? {}),
        updatedAt: new Date(),
      })
      .where(lockedAttemptPredicate(identity));
  } catch {
    // Cleanup still proceeds; an unchanged dispatched attempt also blocks reminting.
  }

  if (projection) {
    try {
      await provider.deleteKey(projection.providerKeyId);
    } catch {
      // Exhaustive correlation cleanup below remains the non-usability proof.
    }
  }

  try {
    await deleteAndConfirmProvisioningCandidates(provider, identity.correlationId);
  } catch {
    // The retained attempt blocks a blind remint while provider state is uncertain.
    return;
  }

  try {
    await database
      .delete(marketApiKeyCreationAttempts)
      .where(lockedAttemptPredicate(identity));
  } catch {
    // Zero enabled candidates is proven; the retained attempt is safe to retry clearing.
  }
}

async function assertCreationAdmission(
  tx: MarketTransaction,
  input: {
    userId: string;
    usageOwnerId: string;
    keyClass: ApiKeyClass;
    adminGrantId: string | null;
  },
) {
  const ownerRows = await tx
    .select({
      id: marketUsageOwner.id,
      ownerUserId: marketUsageOwner.userId,
      activeUserId: user.id,
      emailVerified: user.emailVerified,
    })
    .from(marketUsageOwner)
    .innerJoin(user, eq(user.id, marketUsageOwner.userId))
    .where(
      and(
        eq(marketUsageOwner.id, input.usageOwnerId),
        eq(marketUsageOwner.userId, input.userId),
        eq(user.id, input.userId),
      ),
    )
    .for("update")
    .limit(2);
  const owner = ownerRows[0];
  if (
    ownerRows.length !== 1 ||
    !owner ||
    owner.ownerUserId !== input.userId ||
    owner.activeUserId !== input.userId ||
    owner.emailVerified !== true
  ) {
    throw new Error("Verified Market customer state is missing");
  }

  if (input.keyClass !== "private") return;
  if (!input.adminGrantId) throw new Error("Admin grant is required");
  const grantRows = await tx
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
    .limit(2);
  if (grantRows.length !== 1) {
    throw new ApiKeyCreationConflict("Admin membership is not active");
  }
}

function lockedAttemptPredicate(identity: LockedCreationAttemptIdentity) {
  return and(
    eq(marketApiKeyCreationAttempts.id, identity.attemptId),
    eq(marketApiKeyCreationAttempts.reservedKeyId, identity.reservedKeyId),
    eq(marketApiKeyCreationAttempts.correlationId, identity.correlationId),
  );
}
