import { drizzle } from "drizzle-orm/postgres-js";
import { schema, type MarketDatabase, type MarketReservedConnection } from "@tradinggoose/db";

/** Adapt Postgres.js's query-only reservation to Drizzle's transaction interface. */
export function createReservedDatabaseSession(
  connection: MarketReservedConnection,
  options: MarketDatabase["$client"]["options"],
) {
  let savepointSequence = 0;
  let transactionActive = false;
  type TransactionCallback<T> = (transaction: MarketDatabase["$client"]) => Promise<T>;

  const client = Object.assign(connection, {
    options,
    async begin<T>(callback: TransactionCallback<T>): Promise<T> {
      if (transactionActive) {
        throw new Error("Use the current transaction for nested database work.");
      }
      transactionActive = true;
      try {
        await connection.unsafe("begin");
        const result = await callback(client as unknown as MarketDatabase["$client"]);
        const committed = await connection.unsafe("commit");
        transactionActive = false;
        if (committed.command !== "COMMIT") {
          throw new Error("Reserved database transaction did not commit.");
        }
        return result;
      } catch (error) {
        if (transactionActive) {
          try {
            await rollbackOpenTransaction();
          } catch {
            // The session owner must confirm rollback before releasing it.
          }
        }
        throw error;
      }
    },
    async savepoint<T>(callback: TransactionCallback<T>): Promise<T> {
      const name = `market_sp_${++savepointSequence}`;
      await connection.unsafe(`savepoint ${name}`);
      try {
        const result = await callback(client as unknown as MarketDatabase["$client"]);
        await connection.unsafe(`release savepoint ${name}`);
        return result;
      } catch (error) {
        await connection.unsafe(`rollback to savepoint ${name}`);
        await connection.unsafe(`release savepoint ${name}`);
        throw error;
      }
    },
  });

  async function rollbackOpenTransaction() {
    if (!transactionActive) return;
    await connection.unsafe("rollback");
    transactionActive = false;
  }

  return {
    database: drizzle(client as unknown as MarketDatabase["$client"], { schema }),
    rollbackOpenTransaction,
  };
}
