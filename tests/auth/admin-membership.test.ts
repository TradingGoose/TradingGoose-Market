import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  acquireAdminGrantLock,
  acquireAdminGrantLocks,
} from "../../lib/db/locks";

describe("database admin membership serialization", () => {
  it("takes cross-admin grant locks once in stable lexical order", async () => {
    const observed: string[] = [];
    const dialect = new PgDialect();
    const transaction = {
      execute: vi.fn(async (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const query = dialect.sqlToQuery(statement);
        observed.push(String(query.params[1]));
        return [];
      }),
    };

    await acquireAdminGrantLocks(
      transaction as never,
      ["grant-z", "grant-a", "grant-z", "grant-m"],
    );

    expect(observed).toEqual(["grant-a", "grant-m", "grant-z"]);
  });

  it("rejects an empty grant identity before any database lock side effect", async () => {
    const transaction = { execute: vi.fn() };

    await expect(acquireAdminGrantLock(transaction as never, "  ")).rejects.toThrow(
      /must not be empty/,
    );
    expect(transaction.execute).not.toHaveBeenCalled();
  });
});
