import { afterEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableColumns, sql } from "drizzle-orm";
import { schema } from "@tradinggoose/db";
import type { MarketDatabase } from "@tradinggoose/db";
import {
  createPostgresProtocolFixture,
  type PostgresFixtureColumn,
} from "../helpers/postgres-protocol";

const state = vi.hoisted(() => ({ database: null as MarketDatabase | null }));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => state.database }));
vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({
    billing: { enabled: true, requestNanoUsd: 1_000_000n },
  }),
}));

import { databaseNow } from "../../lib/db/clock";
import {
  getCustomerApiKeyDetail,
  getRollingUsage,
  listAdminApiKeys,
  listCustomerApiKeys,
} from "../../lib/api-keys/service";

const DATABASE_TIMESTAMP = "2026-10-19 12:34:56.123+00";
const ISO_TIMESTAMP = "2026-10-19T12:34:56.123Z";
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  state.database = null;
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function databaseFixture(input: { usage?: boolean; admin?: boolean } = {}) {
  const keyColumns = Object.entries(getTableColumns(schema.marketApiKeys));
  const key: Record<string, string | null> = {
    id: "key_1",
    usageOwnerId: "owner_1",
    userId: "user_1",
    unkeyKeyId: "unkey_1",
    keyClass: input.admin ? "private" : "public",
    adminGrantId: input.admin ? "grant_1" : null,
    name: "API key",
    displayValue: "tg_...1234",
    spendLimitUsd: input.admin ? null : "5",
    spendWindowDays: input.admin ? null : "7",
    spendLimitRevision: input.admin ? null : "1",
    createdAt: DATABASE_TIMESTAMP,
    updatedAt: DATABASE_TIMESTAMP,
  };
  const fixture = await createPostgresProtocolFixture(({ sql: query }) => {
    if (/select now\(\)/i.test(query)) {
      return {
        columns: [{ name: "now", oid: 1184 }],
        rows: [[DATABASE_TIMESTAMP]],
      };
    }
    const count = input.usage ? "1" : "0";
    const lastUsed = input.usage ? DATABASE_TIMESTAMP : null;
    const columns: PostgresFixtureColumn[] = [];
    const row: Array<string | null> = [];
    if (query.includes('from "market_api_keys"')) {
      for (const [property, column] of keyColumns) {
        columns.push({
          name: column.name,
          oid: column.dataType === "date" ? 1184 : column.dataType === "number" ? 23 : 25,
        });
        row.push(key[property] ?? null);
      }
      if (input.admin) {
        columns.push(
          { name: "adminName", oid: 25 },
          { name: "adminEmail", oid: 25 },
          { name: "grantStatus", oid: 25 },
        );
        row.push("Admin", "admin@example.com", "active");
      }
      if (query.includes("max(")) {
        columns.push({ name: "count", oid: 20 }, { name: "lastUsedAt", oid: 1184 });
        row.push(count, lastUsed);
      }
    } else if (query.includes('from "market_api_usage_events"')) {
      columns.push({ name: "count", oid: 20 });
      row.push(count);
      if (query.includes("max(")) {
        columns.push({ name: "lastUsedAt", oid: 1184 });
        row.push(lastUsed);
      } else {
        columns.push({ name: "costUsd", oid: 1700 });
        row.push(input.usage ? "0.001" : "0");
      }
    }
    return columns.length ? { columns, rows: [row] } : {};
  });
  cleanup.push(fixture.close);
  const client = postgres(fixture.url, {
    prepare: false,
    fetch_types: false,
    max: 1,
    ssl: false,
  });
  cleanup.push(() => client.end({ timeout: 0 }));
  const database = drizzle(client, { schema });
  state.database = database;
  return { database, fixture };
}

describe("usage timestamps through installed Postgres.js and Drizzle", () => {
  it("decodes the database clock before serializing it into a timestamp column", async () => {
    const { database, fixture } = await databaseFixture();
    await database.transaction(async (tx) => {
      const raw = await tx.execute(sql`select now()`);
      expect(raw[0].now).toBe(DATABASE_TIMESTAMP);
      const now = await databaseNow(tx);
      expect(now).toBeInstanceOf(Date);
      expect(now.toISOString()).toBe(ISO_TIMESTAMP);
      await tx.insert(schema.marketApiUsageCompletion).values({
        eventId: "event_1",
        httpStatus: 200,
        resultClass: "success",
        completedAt: now,
      });
    });
    const insert = fixture.queries.find((query) => query.sql.startsWith("insert into"));
    expect(insert?.parameters).toContain(ISO_TIMESTAMP);
  });

  it("reads a capped key's rolling window with no usage using the database clock", async () => {
    await databaseFixture();
    await expect(getRollingUsage("key_1", "5", 7)).resolves.toMatchObject({
      requestQuantity: 0,
      costUsd: "0",
      remainingUsd: "5",
      nextCostEligibleAt: null,
    });
  });

  it.each([false, true])("renders a capped customer list and detail with usage=%s", async (usage) => {
    await databaseFixture({ usage });
    const [listed] = await listCustomerApiKeys("user_1");
    const detail = await getCustomerApiKeyDetail("user_1", "key_1");
    for (const key of [listed, detail]) {
      expect(key.lastUsedAt).toBe(usage ? ISO_TIMESTAMP : null);
      expect(key.totalRequestCount).toBe(usage ? 1 : 0);
      expect(key.createdAt).toBe(ISO_TIMESTAMP);
      expect(key.rollingBillableCostUsd).toBe(usage ? "0.001" : "0");
    }
  });

  it("renders an admin key's last-used aggregate after a private request", async () => {
    await databaseFixture({ usage: true, admin: true });
    const [key] = await listAdminApiKeys();
    expect(key.lastUsedAt).toBe(ISO_TIMESTAMP);
    expect(key.totalRequestCount).toBe(1);
    expect(key.originatingAdminName).toBe("Admin");
  });
});
