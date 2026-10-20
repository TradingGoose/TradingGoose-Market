import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const reservedConnection = { release: vi.fn() };
  const reserve = vi.fn(async () => reservedConnection);
  const database = { $client: { reserve } };
  return {
    createMarketDatabase: vi.fn(() => database),
    database,
    reserve,
    reservedConnection,
  };
});

vi.mock("@tradinggoose/db", () => ({
  createMarketDatabase: mocks.createMarketDatabase,
}));

vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({
    databaseUrl: "postgresql://market@database.example.com/market",
  }),
}));

import {
  requireDatabase,
  reserveDatabaseConnection,
  withDatabaseContext,
} from "../../lib/db/runtime";

describe("database runtime composition", () => {
  it("constructs one database from the validated runtime URL and owns reservations", async () => {
    expect(requireDatabase()).toBe(mocks.database);
    expect(requireDatabase()).toBe(mocks.database);
    expect(mocks.createMarketDatabase).toHaveBeenCalledOnce();
    expect(mocks.createMarketDatabase).toHaveBeenCalledWith(
      "postgresql://market@database.example.com/market"
    );

    await expect(reserveDatabaseConnection()).resolves.toBe(
      mocks.reservedConnection
    );
    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.createMarketDatabase).toHaveBeenCalledOnce();
  });

  it("keeps a session's database context through awaits without leaking between requests", async () => {
    const first = { marker: "first" } as unknown as ReturnType<typeof requireDatabase>;
    const second = { marker: "second" } as unknown as ReturnType<typeof requireDatabase>;
    await Promise.all([first, second].map((scoped) => withDatabaseContext(scoped, async () => {
      expect(requireDatabase()).toBe(scoped);
      await Promise.resolve();
      expect(requireDatabase()).toBe(scoped);
    })));
    expect(requireDatabase()).toBe(mocks.database);
  });
});
