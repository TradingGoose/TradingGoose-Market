import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createMarketDatabase: vi.fn(() => ({})) }));
vi.mock("@tradinggoose/db", () => ({ createMarketDatabase: mocks.createMarketDatabase }));
vi.mock("@/lib/environment", () => ({
  getMarketRuntimeConfig: () => ({ databaseUrl: "postgresql://market@database.example.com/market" }),
}));

import { requireDatabase } from "../../lib/db/runtime";

describe("database runtime composition", () => {
  it("lazily reuses one database for the configured URL", () => {
    expect(mocks.createMarketDatabase).not.toHaveBeenCalled();
    expect(requireDatabase()).toBe(requireDatabase());
    expect(mocks.createMarketDatabase).toHaveBeenCalledExactlyOnceWith(
      "postgresql://market@database.example.com/market",
    );
  });

  it("constructs an unprepared Postgres.js client with the existing timeouts", async () => {
    const { createMarketDatabase } = await vi.importActual<typeof import("@tradinggoose/db")>("@tradinggoose/db");
    const client = createMarketDatabase("postgresql://market@127.0.0.1/market_quality").$client;
    expect(client.options).toMatchObject({ prepare: false, idle_timeout: 20, connect_timeout: 10 });
    await client.end();
  });
});
