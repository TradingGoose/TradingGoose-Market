import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseState = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/db/runtime", () => ({ requireDatabase: () => databaseState.current }));

import { schema } from "@tradinggoose/db";
import { resolveKeyedMarketRoute } from "../../lib/market-api/core/manifest";
import { insertMarketUsageAdmission } from "../../lib/usage/admission";
import {
  completeUsageWithoutChangingResponse,
  insertMarketUsageCompletion,
} from "../../lib/usage/completion";

beforeEach(() => {
  databaseState.current = null;
});

describe("immutable usage admission and insert-once completion", () => {
  it("writes the enabled admission before updating the same owner's userStats", async () => {
    const fixture = admissionTransaction();
    const descriptor = resolveKeyedMarketRoute("/api/search/listings")!;

    const eventId = await insertMarketUsageAdmission({
      tx: fixture.transaction as never,
      actor: {
        keyId: "key_public",
        keyClass: "public",
        usageOwnerId: "owner_1",
        userId: "user_1",
        adminGrantId: null,
      },
      descriptor,
      method: "GET",
      billingMode: "enabled",
      rateUsdPer1000Reads: "1",
      billableCostUsd: "0.001",
      attribution: { url: "https://example.com/app", title: "Portfolio" },
      admittedAt: new Date("2026-07-19T00:00:00.000Z"),
    });

    expect(eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fixture.order).toEqual(["event", "stats-read", "stats-update"]);
    expect(fixture.event()).toMatchObject({
      id: eventId,
      usageOwnerId: "owner_1",
      marketApiKeyId: "key_public",
      routeId: "public.search.listings",
      category: "public.search.listings",
      resourceId: "listing_identity",
      billingMode: "enabled",
      billableQuantity: 1,
      rateUsdPer1000Reads: "1",
      billableCostUsd: "0.001",
      applicationUrl: "https://example.com/app",
      applicationTitle: "Portfolio",
    });
    expect(fixture.statsUpdate()).toMatchObject({
      lastActive: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it("does not touch userStats when an admission insert fails", async () => {
    const fixture = admissionTransaction({ failEventInsert: true });
    const descriptor = resolveKeyedMarketRoute("/api/search")!;

    await expect(
      insertMarketUsageAdmission({
        tx: fixture.transaction as never,
        actor: {
          keyId: "key_public",
          keyClass: "public",
          usageOwnerId: "owner_1",
          userId: "user_1",
          adminGrantId: null,
        },
        descriptor,
        method: "HEAD",
        billingMode: "enabled",
        rateUsdPer1000Reads: "2",
        billableCostUsd: "0.002",
        attribution: { url: null, title: null },
        admittedAt: new Date(),
      }),
    ).rejects.toThrow("event insert failed");
    expect(fixture.order).toEqual(["event"]);
    expect(fixture.statsUpdate()).toBeNull();
  });

  it.each([
    { keyClass: "public" as const, method: "GET" as const },
    { keyClass: "private" as const, method: "POST" as const },
  ])("records disabled/admin history as non-billable without userStats: %#", async ({ keyClass, method }) => {
    const fixture = admissionTransaction();
    const descriptor = resolveKeyedMarketRoute(
      keyClass === "public" ? "/api/get/market-hours" : "/api/update/listing-rank",
    )!;
    await insertMarketUsageAdmission({
      tx: fixture.transaction as never,
      actor: {
        keyId: `key_${keyClass}`,
        keyClass,
        usageOwnerId: "owner_1",
        userId: keyClass === "public" ? "user_1" : null,
        adminGrantId: keyClass === "private" ? "grant_1" : null,
      },
      descriptor,
      method,
      billingMode: "disabled",
      rateUsdPer1000Reads: null,
      billableCostUsd: null,
      attribution: { url: null, title: null },
      admittedAt: new Date(),
    });
    expect(fixture.event()).toMatchObject({
      billableQuantity: 0,
      rateUsdPer1000Reads: null,
      billableCostUsd: null,
    });
    expect(fixture.order).toEqual(["event"]);
  });

  it("keeps a produced response when completion storage crashes, leaving admission pending", async () => {
    const response = Response.json({ ok: true }, { status: 202 });
    databaseState.current = completionDatabase({ insertFailure: true });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(completeUsageWithoutChangingResponse("event_pending", response)).resolves.toBe(
      response,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Market usage completion write failed",
      { eventId: "event_pending", errorClass: "Error" },
    );
  });

  it("accepts one completion and treats the identical replay as idempotent", async () => {
    const database = completionDatabase();
    databaseState.current = database;

    await insertMarketUsageCompletion("event_once", 422);
    await insertMarketUsageCompletion("event_once", 422);

    expect(database.rows.get("event_once")).toEqual({
      eventId: "event_once",
      httpStatus: 422,
      resultClass: "client_error",
    });
    await expect(insertMarketUsageCompletion("event_once", 500)).rejects.toThrow(
      /conflicting outcome/,
    );
  });
});

function admissionTransaction(options: { failEventInsert?: boolean } = {}) {
  const order: string[] = [];
  let event: Record<string, unknown> | null = null;
  let statsUpdate: Record<string, unknown> | null = null;
  const transaction = {
    insert(table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          if (table === schema.marketApiUsageEvent) {
            order.push("event");
            if (options.failEventInsert) throw new Error("event insert failed");
            event = values;
          }
        },
      };
    },
    select() {
      const builder = {
        from() {
          return builder;
        },
        where() {
          return builder;
        },
        for() {
          return builder;
        },
        async limit() {
          order.push("stats-read");
          return [{
            id: "stats_1",
            userId: "user_1",
            usageOwnerId: "owner_1",
            billingReferenceId: "user_1",
          }];
        },
      };
      return builder;
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          if (table === schema.userStats) {
            order.push("stats-update");
            statsUpdate = values;
          }
          return { async where() {} };
        },
      };
    },
  };
  return {
    transaction,
    order,
    event: () => event,
    statsUpdate: () => statsUpdate,
  };
}

function completionDatabase(options: { insertFailure?: boolean } = {}) {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    insert() {
      let candidate: Record<string, unknown>;
      const builder = {
        values(value: Record<string, unknown>) {
          candidate = value;
          return builder;
        },
        onConflictDoNothing() {
          return builder;
        },
        async returning() {
          if (options.insertFailure) throw new Error("completion unavailable");
          const id = String(candidate.eventId);
          if (rows.has(id)) return [];
          rows.set(id, candidate);
          return [{ eventId: id }];
        },
      };
      return builder;
    },
    select() {
      const builder = {
        from() {
          return builder;
        },
        where() {
          return builder;
        },
        async limit() {
          return [...rows.values()].slice(-1);
        },
      };
      return builder;
    },
  };
}
