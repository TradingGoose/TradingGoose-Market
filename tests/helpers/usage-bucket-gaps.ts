import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { expect, vi } from "vitest";

/** Exercise the shared customer/admin queries against real UTC PostgreSQL buckets. */
export async function assertUsageBucketGaps(database: ReturnType<typeof postgres>) {
  const [{ ensureMarketCustomerState }, queries, { resolveKeyedMarketRoute }] = await Promise.all([
    import("../../lib/billing/customer-state"),
    import("../../lib/usage/queries"),
    import("../../lib/market-api/core/manifest"),
  ]);
  const userId = `usage_gap_${randomUUID()}`;
  await database`
    insert into "user" (id, name, email, email_verified, created_at, updated_at)
    values (${userId}, 'Usage gap fixture', ${`${userId}@example.com`}, true, now(), now())
  `;
  const customer = await ensureMarketCustomerState(userId);
  const publicKey = `public_${randomUUID()}`;
  const privateKey = `private_${randomUUID()}`;
  const [grant] = await database<{ id: string }[]>`
    insert into system_admin (user_id) values (${userId}) returning id
  `;
  for (const [id, keyClass, grantId] of [
    [publicKey, "public", null],
    [privateKey, "private", grant.id],
  ] as const) {
    await database`
      insert into market_api_keys (
        id, usage_owner_id, user_id, admin_grant_id, unkey_key_id, key_class,
        name, display_value, spend_limit_revision, spend_limit_updated_at
      ) values (
        ${id}, ${customer.usageOwner.id}, ${userId}, ${grantId}, ${`provider_${id}`},
        ${keyClass}, 'Usage gap fixture', 'tg_gap_masked',
        ${keyClass === "public" ? 1 : null}, ${keyClass === "public" ? new Date() : null}
      )
    `;
  }

  async function insert(keyId: string, path: string, timestamp: string, quantity: number) {
    const route = resolveKeyedMarketRoute(path)!;
    const isPrivate = keyId === privateKey;
    for (let index = 0; index < quantity; index++) {
      await database`
        insert into market_api_usage_events (
          id, usage_owner_id, market_api_key_id, key_class, route_id, category,
          resource_id, method, api_version, billing_mode, billable_quantity, admitted_at
        ) values (
          ${`event_${randomUUID()}`}, ${customer.usageOwner.id}, ${keyId},
          ${isPrivate ? "private" : "public"}, ${route.id}, ${route.category},
          ${route.resource.id}, ${isPrivate ? "POST" : "GET"}, 'v1', 'disabled', 0,
          ${new Date(timestamp)}
        )
      `;
    }
  }
  await insert(publicKey, "/api/search/countries", "2026-07-20T12:00:00Z", 10);
  await insert(publicKey, "/api/search/exchanges", "2026-07-22T12:00:00Z", 10);
  // The padded edge labels must not widen the original [start, end) admission filter.
  await insert(publicKey, "/api/search/countries", "2026-07-16T11:59:59.999Z", 1);
  await insert(publicKey, "/api/search/countries", "2026-07-23T12:00:00Z", 1);
  await insert(privateKey, "/api/update/crypto-rank", "2026-07-20T12:00:00Z", 2);

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
  try {
    const activity = await queries.getCustomerActivity(userId, { range: "7d", group: "resource" });
    expect(activity.totalRequests).toBe(20);
    expect(activity.buckets.map((row) => row.requests)).toEqual([0, 0, 0, 0, 10, 0, 10, 0]);
    expect(activity.buckets.map((row) => row.timestamp)).toEqual([
      "2026-07-16T00:00:00Z", "2026-07-17T00:00:00Z", "2026-07-18T00:00:00Z", "2026-07-19T00:00:00Z",
      "2026-07-20T00:00:00Z", "2026-07-21T00:00:00Z", "2026-07-22T00:00:00Z", "2026-07-23T00:00:00Z",
    ]);
    expect(activity.series).toHaveLength(16);
    for (const bucket of activity.buckets) {
      const series = activity.series.filter((point) => point.timestamp === bucket.timestamp);
      expect(series.map((point) => point.seriesId).sort()).toEqual(["country", "exchange"]);
      expect(series.reduce((sum, point) => sum + point.requests, 0)).toBe(bucket.requests);
      expect(series.every((point) => point.successes === 0 && point.errors === 0)).toBe(true);
    }
    const filtered = await queries.getCustomerActivity(userId, { range: "7d", resourceId: "country" });
    expect(filtered.totalRequests).toBe(10);
    expect(filtered.buckets.map((row) => row.requests)).toEqual([0, 0, 0, 0, 10, 0, 0, 0]);
    const admin = await queries.getAdminActivity({ range: "7d", keyId: privateKey });
    expect(admin.totalRequests).toBe(2);
    expect(admin.buckets.map((row) => row.requests)).toEqual([0, 0, 0, 0, 2, 0, 0, 0]);
    const logs = await queries.getCustomerLogs(userId, { range: "7d", limit: 1 });
    expect(logs.histogram).toHaveLength(168);
    expect(logs.histogram.reduce((sum, row) => sum + row.requests, 0)).toBe(20);
    const next = await queries.getCustomerLogs(userId, { range: "7d", limit: 1, cursor: logs.nextCursor });
    expect(next.histogram).toEqual(logs.histogram);
  } finally {
    vi.useRealTimers();
  }
}
