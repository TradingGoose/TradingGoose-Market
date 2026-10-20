import { describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { schema } from "@tradinggoose/db";
import { createPostgresProtocolFixture, type PostgresFixtureResult } from "../helpers/postgres-protocol";

const mocks = vi.hoisted(() => ({ createMarketDatabase: vi.fn() }));

vi.mock("@tradinggoose/db", async (importOriginal) => ({
  ...await importOriginal<typeof import("@tradinggoose/db")>(),
  createMarketDatabase: mocks.createMarketDatabase,
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({ databaseUrl: "postgresql://fixture/fixture" }),
}));

import { withAdminGrantHandlerLock } from "../../lib/db/locks";
import { requireDatabase } from "../../lib/db/runtime";
import { completeUsageWithoutChangingResponse } from "../../lib/usage/completion";

describe("session-lock database execution context", () => {
  it("finishes handlers and completion writes when grant waiters reserve every pool connection", async () => {
    let owner: number | null = null;
    let notifySaturated!: () => void;
    const saturated = new Promise<void>((resolve) => { notifySaturated = resolve; });
    const waiters: Array<{ connectionId: number; resolve: (result: PostgresFixtureResult) => void }> = [];
    const fixture = await createPostgresProtocolFixture(({ connectionId, sql: query, parameters, phase }) => {
      const unlocked = { columns: [{ name: "unlocked", oid: 16 }], rows: [["t"]] };
      if (/pg_advisory_unlock\(/i.test(query)) {
        if (phase === "execute") {
          expect(connectionId).toBe(owner);
          const next = waiters.shift();
          owner = next?.connectionId ?? null;
          next?.resolve({});
        }
        return unlocked;
      }
      if (/pg_advisory_lock\(/i.test(query)) {
        if (phase === "describe") return {};
        if (owner === null) {
          owner = connectionId;
          return {};
        }
        return new Promise<PostgresFixtureResult>((resolve) => {
          waiters.push({ connectionId, resolve });
          notifySaturated();
        });
      }
      if (/^insert into "market_api_usage_completions"/i.test(query)) {
        if (phase === "execute") expect(connectionId).toBe(owner);
        return { columns: [{ name: "event_id", oid: 25 }], rows: [[parameters[0] ?? "event"]] };
      }
      if (/select 42/i.test(query)) {
        if (phase === "execute") expect(connectionId).toBe(owner);
        return { columns: [{ name: "answer", oid: 23 }], rows: [["42"]] };
      }
      return {};
    });
    const client = postgres(fixture.url, {
      max: 2,
      prepare: false,
      fetch_types: false,
      ssl: false,
    });
    const database = drizzle(client, { schema });
    mocks.createMarketDatabase.mockReturnValue(database);

    try {
      await client.unsafe("select 1");
      const first = await client.reserve();
      await client.unsafe("select 1");
      first.release();
      const completed: number[] = [];
      await Promise.all(Array.from({ length: 6 }, (_, index) =>
        withAdminGrantHandlerLock("grant_1", async (reservedDatabase) => {
          expect(requireDatabase()).toBe(reservedDatabase);
          await saturated;
          await reservedDatabase.transaction(async (tx) => {
            await tx.execute(sql`select 42 as answer`);
          });
          // Existing private handlers and the shared completion helper resolve
          // their database through requireDatabase(), inside the grant scope.
          await requireDatabase().execute(sql`select 42 as answer`);
          const response = new Response(null, { status: 204 });
          expect(await completeUsageWithoutChangingResponse(`event_${index}`, response)).toBe(response);
          completed.push(index);
        }),
      ));

      expect(completed).toHaveLength(6);
      expect(owner).toBeNull();
      expect(waiters).toHaveLength(0);
      expect(fixture.connectionCount()).toBe(2);
      expect(requireDatabase()).toBe(database);
      const completions = fixture.queries.filter((query) => /^insert into "market_api_usage_completions"/i.test(query.sql));
      expect(completions).toHaveLength(6);
      expect(new Set(completions.map((query) => query.connectionId)).size).toBe(2);
    } finally {
      await client.end({ timeout: 1 });
      await fixture.close();
    }
  });
});
