import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { schema } from "@tradinggoose/db";
import { createReservedDatabaseSession } from "../../lib/db/reserved";
import {
  createPostgresProtocolFixture,
  type PostgresFixtureQuery,
  type PostgresFixtureResult,
} from "../helpers/postgres-protocol";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function createFixture(
  override?: (query: PostgresFixtureQuery) => PostgresFixtureResult | undefined,
) {
  const fixture = await createPostgresProtocolFixture((input) => {
    const supplied = override?.(input);
    if (supplied) return supplied;
    const query = input.sql;
    if (/select 42/i.test(query)) {
      return { columns: [{ name: "answer", oid: 23 }], rows: [["42"]] };
    }
    return {};
  });
  cleanups.push(fixture.close);
  const client = postgres(fixture.url, {
    max: 1,
    prepare: false,
    fetch_types: false,
    ssl: false,
  });
  cleanups.push(() => client.end({ timeout: 1 }));
  // Match the real Market construction: Drizzle installs its timestamp parsers.
  drizzle(client, { schema });
  await client.unsafe("select 1");
  const connection = await client.reserve();
  return { fixture, client, connection };
}

describe("reserved Postgres.js Drizzle adapter", () => {
  it("uses the installed reservation for reads, committed transactions and nested savepoints", async () => {
    const { fixture, client, connection } = await createFixture();
    expect("options" in connection).toBe(false);
    expect("begin" in connection).toBe(false);
    const { database } = createReservedDatabaseSession(connection, client.options);

    await expect(database.execute(sql`select 42 as answer`)).resolves.toMatchObject([{ answer: 42 }]);
    await expect(database.transaction(async (tx) => {
      const [answer] = await tx.execute(sql`select 42 as answer`);
      await tx.transaction(async (nested) => {
        await nested.execute(sql`select 42 as answer`);
      });
      return answer;
    })).resolves.toMatchObject({ answer: 42 });
    connection.release();
    await client`select 42 as answer`;

    expect(fixture.connectionCount()).toBe(1);
    expect(fixture.queries.slice(1).map((query) => query.sql)).toEqual([
      "select 42 as answer",
      "begin",
      "select 42 as answer",
      "savepoint market_sp_1",
      "select 42 as answer",
      "release savepoint market_sp_1",
      "commit",
      "select 42 as answer",
    ]);
  });

  it("rolls back a failed transaction and can commit the next one on the same reservation", async () => {
    const { fixture, client, connection } = await createFixture();
    const { database } = createReservedDatabaseSession(connection, client.options);
    const failure = new Error("handler failed");
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select 42 as answer`);
      throw failure;
    })).rejects.toBe(failure);
    await database.transaction(async (tx) => {
      await expect(tx.transaction(async () => {
        throw failure;
      })).rejects.toBe(failure);
      await tx.execute(sql`select 42 as answer`);
    });
    connection.release();

    expect(fixture.queries.slice(1).map((query) => query.sql)).toEqual([
      "begin",
      "select 42 as answer",
      "rollback",
      "begin",
      "savepoint market_sp_1",
      "rollback to savepoint market_sp_1",
      "release savepoint market_sp_1",
      "select 42 as answer",
      "commit",
    ]);
    expect(fixture.connectionCount()).toBe(1);
  });

  it("rejects a transaction that PostgreSQL rolls back after a caught query error", async () => {
    const { fixture, client, connection } = await createFixture(({ sql: query, phase }) => {
      if (query === "select fail" && phase === "execute") return { error: "statement failed" };
      if (query === "commit") return { command: "ROLLBACK" };
    });
    const { database, rollbackOpenTransaction } = createReservedDatabaseSession(connection, client.options);
    await expect(database.transaction(async (tx) => {
      await tx.execute(sql`select fail`).catch(() => undefined);
    })).rejects.toThrow("Reserved database transaction did not commit");
    await rollbackOpenTransaction();
    connection.release();

    expect(fixture.queries.slice(1).map((query) => query.sql)).toEqual([
      "begin", "select fail", "commit",
    ]);
  });
});
