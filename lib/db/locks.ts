import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  schema,
  type MarketDatabase,
  type MarketTransaction
} from "@tradinggoose/db";
import {
  requireDatabase,
  reserveDatabaseConnection,
} from "@/lib/db/runtime";

const BILLING_SUBJECT_LOCK_NAMESPACE = 1_847_001;
const ADMIN_GRANT_LOCK_NAMESPACE = 1_847_002;
const API_KEY_LOCK_NAMESPACE = 1_847_003;

export type MarketLockCallback<T> = (transaction: MarketTransaction) => Promise<T>;
export type MarketSessionLockCallback<T> = (database: MarketDatabase) => Promise<T>;
export type MarketApiKeyCreationSessionLockCallback<T> = (
  database: MarketDatabase,
  acquireApiKeySessionLock: (keyId: string) => Promise<void>,
) => Promise<T>;

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
    await acquireBillingSubjectLock(transaction, userId);
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

export async function withAdminGrantLocks<T>(
  grantIds: readonly string[],
  callback: MarketLockCallback<T>,
  database: MarketDatabase = requireDatabase()
): Promise<T> {
  return database.transaction(async (transaction) => {
    await acquireAdminGrantLocks(transaction, grantIds);
    return callback(transaction);
  });
}

export async function withApiKeyLock<T>(
  keyId: string,
  callback: MarketLockCallback<T>,
  database: MarketDatabase = requireDatabase()
): Promise<T> {
  return database.transaction(async (transaction) => {
    await acquireApiKeyLock(transaction, keyId);
    return callback(transaction);
  });
}

type SessionLock = {
  namespace: number;
  id: string;
  subject: string;
};

type SessionLockAttempt = SessionLock & {
  held: boolean;
};

type AcquireSessionLock = (lock: SessionLock) => Promise<void>;

async function withReservedSessionLockOwner<T>(
  initialLocks: readonly SessionLock[],
  callback: (
    database: MarketDatabase,
    acquireSessionLock: AcquireSessionLock,
  ) => Promise<T>,
): Promise<T> {
  const connection = await reserveDatabaseConnection();
  const attemptedLocks: SessionLockAttempt[] = [];
  let callbackResult: T | undefined;
  let hasPrimaryError = false;
  let primaryError: unknown;

  const acquireSessionLock: AcquireSessionLock = async (lock) => {
    const attempt: SessionLockAttempt = { ...lock, held: false };
    attemptedLocks.push(attempt);
    await connection`
      select pg_advisory_lock(
        ${lock.namespace},
        hashtext(${lock.id})
      )
    `;
    attempt.held = true;
  };

  try {
    const database = drizzle(connection, { schema }) as MarketDatabase;
    for (const lock of initialLocks) {
      await acquireSessionLock(lock);
    }
    callbackResult = await callback(database, acquireSessionLock);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  let hasCleanupError = false;
  let cleanupError: unknown;
  let cleanupConfirmed = true;
  const recordCleanupError = (error: unknown) => {
    if (!hasCleanupError) {
      hasCleanupError = true;
      cleanupError = error;
    }
  };

  for (const attempt of attemptedLocks.reverse()) {
    try {
      const [result] = await connection<{ unlocked: boolean }[]>`
        select pg_advisory_unlock(
          ${attempt.namespace},
          hashtext(${attempt.id})
        ) as unlocked
      `;
      if (typeof result?.unlocked !== "boolean") {
        cleanupConfirmed = false;
        recordCleanupError(
          new Error(`${attempt.subject} lock cleanup was not confirmed.`),
        );
      } else if (attempt.held && !result.unlocked) {
        recordCleanupError(
          new Error(
            `${attempt.subject} lock was not held by its reserved connection.`,
          ),
        );
      }
    } catch (error) {
      cleanupConfirmed = false;
      recordCleanupError(error);
    }
  }

  if (!cleanupConfirmed) {
    try {
      await connection`select pg_advisory_unlock_all()`;
      cleanupConfirmed = true;
    } catch {
      // Keep an unconfirmed reserved connection out of the pool.
    }
  }

  if (cleanupConfirmed) {
    try {
      connection.release();
    } catch (error) {
      recordCleanupError(error);
    }
  }

  if (hasPrimaryError) throw primaryError;
  if (hasCleanupError) throw cleanupError;
  return callbackResult as T;
}

export async function withAdminGrantHandlerLock<T>(
  grantId: string,
  callback: MarketSessionLockCallback<T>
): Promise<T> {
  const lockedGrantId = requireLockId(grantId, "Admin grant");
  return withReservedSessionLockOwner(
    [
      {
        namespace: ADMIN_GRANT_LOCK_NAMESPACE,
        id: lockedGrantId,
        subject: "Admin grant handler",
      },
    ],
    async (database) => callback(database),
  );
}

export async function withBillingSubjectAndApiKeyCreationHandlerLocks<T>(
  userId: string,
  callback: MarketApiKeyCreationSessionLockCallback<T>,
): Promise<T> {
  return withDeferredApiKeySessionLock(
    {
      namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
      id: requireLockId(userId, "Billing subject"),
      subject: "Billing subject handler",
    },
    callback,
  );
}

export async function withAdminGrantAndApiKeyCreationHandlerLocks<T>(
  grantId: string,
  callback: MarketApiKeyCreationSessionLockCallback<T>,
): Promise<T> {
  return withDeferredApiKeySessionLock(
    {
      namespace: ADMIN_GRANT_LOCK_NAMESPACE,
      id: requireLockId(grantId, "Admin grant"),
      subject: "Admin grant handler",
    },
    callback,
  );
}

export async function withAdminGrantAndApiKeyHandlerLocks<T>(
  grantIds: readonly string[],
  keyId: string,
  callback: MarketSessionLockCallback<T>,
): Promise<T> {
  const orderedGrantIds = [
    ...new Set(grantIds.map((id) => requireLockId(id, "Admin grant"))),
  ].sort();
  if (orderedGrantIds.length === 0) {
    throw new Error("At least one admin grant lock is required.");
  }
  const lockedKeyId = requireLockId(keyId, "API key");
  const locks = [
    ...orderedGrantIds.map((id) => ({
      namespace: ADMIN_GRANT_LOCK_NAMESPACE,
      id,
      subject: "Admin grant handler",
    })),
    {
      namespace: API_KEY_LOCK_NAMESPACE,
      id: lockedKeyId,
      subject: "API key handler",
    },
  ];
  return withReservedSessionLockOwner(locks, async (database) => callback(database));
}

async function withDeferredApiKeySessionLock<T>(
  outerLock: {
    namespace: number;
    id: string;
    subject: string;
  },
  callback: MarketApiKeyCreationSessionLockCallback<T>,
): Promise<T> {
  let keyLockRequestedId: string | null = null;
  let keyLockId: string | null = null;
  return withReservedSessionLockOwner(
    [outerLock],
    async (database, acquireSessionLock) => {
      const acquireApiKeySessionLock = async (keyId: string) => {
        const lockedKeyId = requireLockId(keyId, "API key");
        if (keyLockRequestedId) {
          if (keyLockRequestedId !== lockedKeyId) {
            throw new Error("API key creation cannot switch its locked local key.");
          }
          throw new Error("API key creation local-key lock was already acquired.");
        }
        keyLockRequestedId = lockedKeyId;
        await acquireSessionLock({
          namespace: API_KEY_LOCK_NAMESPACE,
          id: lockedKeyId,
          subject: "API key creation local-key",
        });
        keyLockId = lockedKeyId;
      };

      const result = await callback(database, acquireApiKeySessionLock);
      if (!keyLockId) {
        throw new Error("API key creation completed without its local-key lock.");
      }
      return result;
    },
  );
}

export async function withBillingSubjectAndApiKeyHandlerLocks<T>(
  userId: string,
  keyId: string,
  callback: MarketSessionLockCallback<T>,
): Promise<T> {
  const lockedUserId = requireLockId(userId, "Billing subject");
  const lockedKeyId = requireLockId(keyId, "API key");
  return withReservedSessionLockOwner(
    [
      {
        namespace: BILLING_SUBJECT_LOCK_NAMESPACE,
        id: lockedUserId,
        subject: "Billing subject handler",
      },
      {
        namespace: API_KEY_LOCK_NAMESPACE,
        id: lockedKeyId,
        subject: "API key handler",
      },
    ],
    async (database) => callback(database),
  );
}
