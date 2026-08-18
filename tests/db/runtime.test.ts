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
});
