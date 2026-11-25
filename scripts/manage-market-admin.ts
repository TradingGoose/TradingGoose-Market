import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { marketApiKeyCreationAttempts, marketApiKeys, systemAdmin, user } from "@tradinggoose/db/schema";
import type { MarketTransaction } from "@tradinggoose/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { reconcileCreationAttempt } from "@/lib/api-keys/creation";
import { confirmMappedKeyRevocation } from "@/lib/api-keys/revocation";
import {
  acquireAdminGrantLock,
  acquireApiKeyLock,
  withBoundedLockAcquisition,
  withAdminGrantLock,
} from "@/lib/db/locks";
import { requireDatabase } from "@/lib/db/runtime";
import { getMarketRuntimeConfig } from "@/lib/environment";

export async function addAdmin(userId: string) {
  const result = await withAdminGrantLock(userId, async (tx) => {
    const users = await tx
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .for("update")
      .limit(2);
    if (
      users.length !== 1 ||
      (users[0]?.emailVerified !== true && getMarketRuntimeConfig().betterAuth.emailVerificationEnabled)
    ) {
      throw new Error("An eligible user is required");
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
  const grants = await database.select().from(systemAdmin).where(eq(systemAdmin.userId, userId)).limit(2);
  if (grants.length === 0) {
    console.info("Admin membership is already absent");
    return;
  }
  if (grants.length !== 1) {
    throw new Error("Admin membership is ambiguous");
  }
  const grant = grants[0]!;

  function locked<T>(keyId: string | null, work: (tx: MarketTransaction) => Promise<T>) {
    return database.transaction(async (tx) => {
      await withBoundedLockAcquisition(tx, async () => {
        await acquireAdminGrantLock(tx, grant.id);
        if (keyId) await acquireApiKeyLock(tx, keyId);
      });
      return work(tx);
    });
  }

  const sameGrant = and(eq(systemAdmin.id, grant.id), eq(systemAdmin.userId, userId));
  const privateKeys = and(eq(marketApiKeys.adminGrantId, grant.id), eq(marketApiKeys.keyClass, "private"));
  const sameGrantAttempts = eq(marketApiKeyCreationAttempts.adminGrantId, grant.id);
  const pending = await locked(null, async (tx) => {
    const keys = await tx.select().from(marketApiKeys).where(privateKeys).orderBy(marketApiKeys.id);
    await withBoundedLockAcquisition(tx, async () => {
      for (const key of keys) await acquireApiKeyLock(tx, key.id);
    });
    const [current] = await tx
      .select({ status: systemAdmin.status })
      .from(systemAdmin)
      .where(sameGrant)
      .for("update")
      .limit(1);
    if (!current) return;
    if (current.status !== "active" && current.status !== "removing") {
      throw new Error("Admin membership has an unknown status");
    }
    await tx.update(systemAdmin).set({ status: "removing", updatedAt: new Date() }).where(sameGrant);
    await tx
      .update(marketApiKeys)
      .set({ revocationRequestedAt: new Date(), updatedAt: new Date() })
      .where(and(privateKeys, isNull(marketApiKeys.revocationRequestedAt)));
    const attempts = await tx
      .select()
      .from(marketApiKeyCreationAttempts)
      .where(sameGrantAttempts)
      .orderBy(marketApiKeyCreationAttempts.reservedKeyId);
    return { keys, attempts };
  });
  if (!pending) return;

  for (const key of pending.keys) {
    if (key.providerRevokedAt) continue;
    const outcome = await locked(key.id, (tx) => confirmMappedKeyRevocation(tx, key));
    if (outcome.retryable) throw new Error("Provider revocation is not confirmed for an admin key");
  }
  for (const attempt of pending.attempts) {
    const failure = await locked(attempt.reservedKeyId, (tx) => reconcileCreationAttempt(tx, attempt));
    if (failure) throw failure.error;
  }
  await locked(null, async (tx) => {
    const [current] = await tx
      .select({ status: systemAdmin.status })
      .from(systemAdmin)
      .where(sameGrant)
      .for("update")
      .limit(1);
    if (!current) return;
    if (current.status !== "removing") throw new Error("Admin membership is not removing");
    const unconfirmed = await tx
      .select({ id: marketApiKeys.id })
      .from(marketApiKeys)
      .where(
        and(
          privateKeys,
          or(isNull(marketApiKeys.revocationRequestedAt), isNull(marketApiKeys.providerRevokedAt)),
        ),
      )
      .limit(1);
    const unresolved = await tx
      .select({ id: marketApiKeyCreationAttempts.id })
      .from(marketApiKeyCreationAttempts)
      .where(sameGrantAttempts)
      .limit(1);
    if (unconfirmed[0] || unresolved[0]) throw new Error("Admin provider state is not fully reconciled");
    await tx.delete(systemAdmin).where(and(sameGrant, eq(systemAdmin.status, "removing")));
  });
  console.info("Admin membership removed; public customer state and history were retained");
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
