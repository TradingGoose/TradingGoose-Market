import { sql } from "drizzle-orm";
import {
  type MarketDatabase,
  type MarketTransaction
} from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

const BILLING_SUBJECT_LOCK_NAMESPACE = 1_847_001;
const ADMIN_GRANT_LOCK_NAMESPACE = 1_847_002;
const API_KEY_LOCK_NAMESPACE = 1_847_003;

export type MarketLockCallback<T> = (transaction: MarketTransaction) => Promise<T>;

export async function withBoundedLockAcquisition(
  tx: MarketTransaction,
  acquire: () => Promise<void>,
) {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await acquire();
  await tx.execute(sql`set local lock_timeout = default`);
}

function requireLockId(id: string, subject: string): string {
  if (!id || !id.trim()) {
    throw new Error(`${subject} lock ID must not be empty.`);
  }
  return id;
}

async function acquireLock(
  transaction: MarketTransaction,
  namespace: number,
  id: string
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(${namespace}, hashtext(${id}))`
  );
}

export async function acquireBillingSubjectLock(
  transaction: MarketTransaction,
  userId: string
): Promise<void> {
  await acquireLock(
    transaction,
    BILLING_SUBJECT_LOCK_NAMESPACE,
    requireLockId(userId, "Billing subject")
  );
}

export async function acquireAdminGrantLock(
  transaction: MarketTransaction,
  grantId: string
): Promise<void> {
  await acquireLock(
    transaction,
    ADMIN_GRANT_LOCK_NAMESPACE,
    requireLockId(grantId, "Admin grant")
  );
}

export async function acquireAdminGrantLocks(
  transaction: MarketTransaction,
  grantIds: readonly string[]
): Promise<void> {
  const orderedGrantIds = [...new Set(grantIds.map((id) => requireLockId(id, "Admin grant")))].sort();
  for (const grantId of orderedGrantIds) {
    await acquireAdminGrantLock(transaction, grantId);
  }
}

export async function acquireApiKeyLock(
  transaction: MarketTransaction,
  keyId: string
): Promise<void> {
  await acquireLock(
    transaction,
    API_KEY_LOCK_NAMESPACE,
    requireLockId(keyId, "API key")
  );
}

export async function withBillingSubjectLock<T>(
  userId: string,
  callback: MarketLockCallback<T>,
  database: MarketDatabase = requireDatabase()
): Promise<T> {
  return database.transaction(async (transaction) => {
    await withBoundedLockAcquisition(transaction, () => acquireBillingSubjectLock(transaction, userId));
    return callback(transaction);
  });
}

export async function withAdminGrantLock<T>(
  grantId: string,
  callback: MarketLockCallback<T>,
  database: MarketDatabase = requireDatabase()
): Promise<T> {
  return database.transaction(async (transaction) => {
    await acquireAdminGrantLock(transaction, grantId);
    return callback(transaction);
  });
}
