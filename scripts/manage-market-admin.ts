import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  marketApiKeyCreationAttempts,
  marketApiKeys,
  systemAdmin,
  user,
} from "@tradinggoose/db/schema";
import type { MarketDatabase } from "@tradinggoose/db";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { confirmProviderKeyRevocation } from "@/lib/api-keys/revocation";
import {
  acquireAdminGrantLock,
  acquireApiKeyLock,
  withAdminGrantHandlerLock,
  withAdminGrantLock,
} from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { deleteAndConfirmProvisioningCandidates } from "@/lib/unkey/provisioning";
import { getMarketKeyProvider } from "@/lib/unkey/runtime";

export async function addAdmin(userId: string) {
  const result = await withAdminGrantLock(userId, async (tx) => {
    const users = await tx
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .for("update")
      .limit(2);
    if (users.length !== 1 || users[0]?.emailVerified !== true) {
      throw new Error("A verified user is required");
    }
    const existing = await tx
      .select({ id: systemAdmin.id })
      .from(systemAdmin)
      .where(eq(systemAdmin.userId, userId))
      .for("update")
      .limit(2);
    if (existing.length !== 0) {
      throw new Error("Admin membership already exists");
    }
    const inserted = await tx
      .insert(systemAdmin)
      .values({ userId, status: "active" })
      .returning();
    if (inserted.length !== 1) {
      throw new Error("Admin membership could not be created");
    }
    return inserted[0];
  });
  console.info(`Admin membership active: ${result.id}`);
  return result;
}

export async function removeAdmin(userId: string) {
  const database = requireDatabase();
  const grants = await database
    .select()
    .from(systemAdmin)
    .where(eq(systemAdmin.userId, userId))
    .limit(2);
  if (grants.length === 0) {
    console.info("Admin membership is already absent");
    return;
  }
  if (grants.length !== 1) {
    throw new Error("Admin membership is ambiguous");
  }
  const grant = grants[0]!;

  await withAdminGrantHandlerLock(grant.id, async (reservedDatabase) => {
    const exists = await markGrantAndMappedKeysRemoving(
      reservedDatabase,
      grant.id,
      userId,
    );
    if (!exists) return;

    const keys = await reservedDatabase
      .select()
      .from(marketApiKeys)
      .where(
        and(
          eq(marketApiKeys.adminGrantId, grant.id),
          eq(marketApiKeys.keyClass, "private"),
        ),
      )
      .orderBy(marketApiKeys.id);
    for (const key of keys) {
      if (key.providerRevokedAt) continue;
      const provider = getMarketKeyProvider();
      const outcome = await confirmProviderKeyRevocation(
        key.unkeyKeyId,
        provider,
      );
      if (outcome.status === "revocation_pending") {
        throw new Error("Provider revocation is not confirmed for an admin key");
      }
      await reservedDatabase.transaction(async (tx) => {
        await acquireAdminGrantLock(tx, grant.id);
        await acquireApiKeyLock(tx, key.id);
        const updated = await tx
          .update(marketApiKeys)
          .set({ providerRevokedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(marketApiKeys.id, key.id),
              eq(marketApiKeys.adminGrantId, grant.id),
              eq(marketApiKeys.keyClass, "private"),
              eq(marketApiKeys.unkeyKeyId, key.unkeyKeyId),
              isNotNull(marketApiKeys.revocationRequestedAt),
            ),
          )
          .returning({ id: marketApiKeys.id });
        if (updated.length !== 1) {
          throw new Error("Admin key revocation state changed before confirmation");
        }
      });
    }

    const attempts = await reservedDatabase
      .select()
      .from(marketApiKeyCreationAttempts)
      .where(
        and(
          eq(marketApiKeyCreationAttempts.adminGrantId, grant.id),
          eq(marketApiKeyCreationAttempts.keyClass, "private"),
        ),
      )
      .orderBy(marketApiKeyCreationAttempts.id);
    for (const attempt of attempts) {
      if (attempt.state === "reserved") {
        await deleteReconciledAttempt(reservedDatabase, grant.id, attempt);
        continue;
      }
      if (attempt.state !== "dispatched" && attempt.state !== "cleanup_required") {
        throw new Error("Admin key creation attempt has an unknown state");
      }
      const provider = getMarketKeyProvider();
      if (attempt.providerKeyId) {
        const outcome = await confirmProviderKeyRevocation(
          attempt.providerKeyId,
          provider,
        );
        if (outcome.status === "revocation_pending") {
          throw new Error("Known admin provisioning key revocation is not confirmed");
        }
      }
      await deleteAndConfirmProvisioningCandidates(
        provider,
        attempt.correlationId,
      );
      await deleteReconciledAttempt(reservedDatabase, grant.id, attempt);
    }

    await reservedDatabase.transaction(async (tx) => {
      await acquireAdminGrantLock(tx, grant.id);
      const finalKeys = await tx
        .select({ id: marketApiKeys.id })
        .from(marketApiKeys)
        .where(
          and(
            eq(marketApiKeys.adminGrantId, grant.id),
            eq(marketApiKeys.keyClass, "private"),
            or(
              isNull(marketApiKeys.revocationRequestedAt),
              isNull(marketApiKeys.providerRevokedAt),
            ),
          ),
        )
        .limit(1);
      const finalAttempts = await tx
        .select({ id: marketApiKeyCreationAttempts.id })
        .from(marketApiKeyCreationAttempts)
        .where(eq(marketApiKeyCreationAttempts.adminGrantId, grant.id))
        .limit(1);
      if (finalKeys[0] || finalAttempts[0]) {
        throw new Error("Admin provider state is not fully reconciled");
      }
      const current = await tx
        .select({ id: systemAdmin.id })
        .from(systemAdmin)
        .where(
          and(
            eq(systemAdmin.id, grant.id),
            eq(systemAdmin.userId, userId),
            eq(systemAdmin.status, "removing"),
          ),
        )
        .for("update")
        .limit(2);
      if (current.length !== 1) {
        throw new Error("Removing admin membership changed before finalization");
      }
      const deleted = await tx
        .delete(systemAdmin)
        .where(
          and(
            eq(systemAdmin.id, grant.id),
            eq(systemAdmin.userId, userId),
            eq(systemAdmin.status, "removing"),
          ),
        )
        .returning({ id: systemAdmin.id });
      if (deleted.length !== 1) {
        throw new Error("Removing admin membership could not be finalized");
      }
    });
  });
  console.info("Admin membership removed; public customer state and history were retained");
}

async function markGrantAndMappedKeysRemoving(
  database: MarketDatabase,
  grantId: string,
  userId: string,
) {
  return database.transaction(async (tx) => {
    await acquireAdminGrantLock(tx, grantId);
    const current = await tx
      .select({ id: systemAdmin.id, status: systemAdmin.status })
      .from(systemAdmin)
      .where(
        and(eq(systemAdmin.id, grantId), eq(systemAdmin.userId, userId)),
      )
      .for("update")
      .limit(2);
    if (current.length === 0) return false;
    if (current.length !== 1) throw new Error("Admin membership is ambiguous");
    if (current[0]!.status !== "active" && current[0]!.status !== "removing") {
      throw new Error("Admin membership has an unknown status");
    }
    const marked = await tx
      .update(systemAdmin)
      .set({ status: "removing", updatedAt: new Date() })
      .where(and(eq(systemAdmin.id, grantId), eq(systemAdmin.userId, userId)))
      .returning({ id: systemAdmin.id });
    if (marked.length !== 1) {
      throw new Error("Admin membership could not enter removing state");
    }

    const bound = await tx
      .select({ id: marketApiKeys.id, providerKeyId: marketApiKeys.unkeyKeyId })
      .from(marketApiKeys)
      .where(
        and(
          eq(marketApiKeys.adminGrantId, grantId),
          eq(marketApiKeys.keyClass, "private"),
        ),
      )
      .orderBy(marketApiKeys.id);
    for (const key of bound) {
      await acquireApiKeyLock(tx, key.id);
      const requested = await tx
        .update(marketApiKeys)
        .set({ revocationRequestedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(marketApiKeys.id, key.id),
            eq(marketApiKeys.adminGrantId, grantId),
            eq(marketApiKeys.keyClass, "private"),
            eq(marketApiKeys.unkeyKeyId, key.providerKeyId),
          ),
        )
        .returning({ id: marketApiKeys.id });
      if (requested.length !== 1) {
        throw new Error("Admin key changed while removal was being recorded");
      }
    }
    return true;
  });
}

async function deleteReconciledAttempt(
  database: MarketDatabase,
  grantId: string,
  attempt: typeof marketApiKeyCreationAttempts.$inferSelect,
) {
  await database.transaction(async (tx) => {
    await acquireAdminGrantLock(tx, grantId);
    await acquireApiKeyLock(tx, attempt.reservedKeyId);
    const current = await tx
      .select()
      .from(marketApiKeyCreationAttempts)
      .where(
        and(
          eq(marketApiKeyCreationAttempts.id, attempt.id),
          eq(marketApiKeyCreationAttempts.reservedKeyId, attempt.reservedKeyId),
          eq(marketApiKeyCreationAttempts.correlationId, attempt.correlationId),
          eq(marketApiKeyCreationAttempts.adminGrantId, grantId),
          eq(marketApiKeyCreationAttempts.keyClass, "private"),
        ),
      )
      .for("update")
      .limit(2);
    const locked = current[0];
    if (
      current.length !== 1 ||
      !locked ||
      locked.state !== attempt.state ||
      locked.providerKeyId !== attempt.providerKeyId
    ) {
      throw new Error("Admin key creation attempt changed during reconciliation");
    }
    const deleted = await tx
      .delete(marketApiKeyCreationAttempts)
      .where(
        and(
          eq(marketApiKeyCreationAttempts.id, attempt.id),
          eq(marketApiKeyCreationAttempts.reservedKeyId, attempt.reservedKeyId),
          eq(marketApiKeyCreationAttempts.correlationId, attempt.correlationId),
          eq(marketApiKeyCreationAttempts.adminGrantId, grantId),
          eq(marketApiKeyCreationAttempts.keyClass, "private"),
          eq(marketApiKeyCreationAttempts.state, attempt.state),
          ...(attempt.providerKeyId
            ? [eq(marketApiKeyCreationAttempts.providerKeyId, attempt.providerKeyId)]
            : [isNull(marketApiKeyCreationAttempts.providerKeyId)]),
        ),
      )
      .returning({ id: marketApiKeyCreationAttempts.id });
    if (deleted.length !== 1) {
      throw new Error("Reconciled admin key creation attempt could not be cleared");
    }
  });
}

export function parseArgs(args: string[]) {
  const operation = args[0];
  const userFlag = args[1];
  const userId = args[2];
  if (
    (operation !== "add" && operation !== "remove") ||
    userFlag !== "--user-id" ||
    !userId ||
    args.length !== 3
  ) {
    throw new Error(
      "Usage: bun run scripts/manage-market-admin.ts <add|remove> --user-id <user-id>",
    );
  }
  return { operation, userId } as const;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.operation === "add") await addAdmin(parsed.userId);
  else await removeAdmin(parsed.userId);
}
