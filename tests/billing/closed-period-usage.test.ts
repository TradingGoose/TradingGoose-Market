import type { MarketTransaction } from "@tradinggoose/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { getClosedPeriodUsage } from "../../lib/billing/user-stats";

describe("closed PAYG accumulator slice", () => {
  it("excludes previously settled activations even when reactivation shares their Stripe second", async () => {
    const end = new Date("2026-09-01T00:00:00.000Z");
    const dialect = new PgDialect();
    const history = [
      // Settled old subscription and new activation share Stripe's whole second.
      { admittedAt: new Date("2026-08-01T00:00:00.100Z"), cents: 100n },
      { admittedAt: new Date("2026-08-01T00:00:00.800Z"), cents: 100n },
      { admittedAt: end, cents: 1n },
    ];
    const tx = {
      select: () => ({
        from: () => ({
          where: async (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
            const query = dialect.sqlToQuery(condition);
            // Only unswept next-period admissions are read. Old settled events
            // before this boundary must never be replayed into the accumulator.
            expect(query.sql).toContain('"admitted_at" >=');
            expect(query.params).toEqual(["owner_1", 1, end.toISOString()]);
            const selected = history.filter(event => event.admittedAt >= new Date(query.params[2] as string));
            return [{ requestQuantity: String(selected.length),
              costUsd: `0.${selected.reduce((sum, event) => sum + event.cents, 0n).toString().padStart(2, "0")}` }];
          },
        }),
      }),
    } as unknown as MarketTransaction;
    const closed = await getClosedPeriodUsage(tx, {
      usageOwnerId: "owner_1", currentPeriodRequestQuantity: "2", currentPeriodCost: "1.01",
    }, end);
    expect(closed).toEqual({ requestQuantity: "1", costUsd: "1" });
  });

  it("fails closed if newer immutable usage exceeds the current accumulator", async () => {
    const tx = { select: () => ({ from: () => ({ where: async () => [{ requestQuantity: "2", costUsd: "2" }] }) }) } as unknown as MarketTransaction;
    await expect(getClosedPeriodUsage(tx, {
      usageOwnerId: "owner_1", currentPeriodRequestQuantity: "1", currentPeriodCost: "1",
    }, new Date("2026-09-01T00:00:00.000Z"))).rejects.toThrow("exceeds its accumulator");
  });
});
