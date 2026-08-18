import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../../packages/db/schema";

describe("Market standalone authored schema", () => {
  it("contains the ordinary Better Auth graph without legacy authorization state", () => {
    expect("role" in schema.user).toBe(false);
    expect("banned" in schema.user).toBe(false);
    expect("impersonatedBy" in schema.session).toBe(false);
    expect("invitation" in schema).toBe(false);
    expect("marketKeys" in schema).toBe(false);
    expect(schema.user.stripeCustomerId).toBeDefined();
    expect(schema.systemAdmin.status).toBeDefined();
  });

  it("owns the generic subscription and literal userStats bridges", () => {
    expect(getTableConfig(schema.subscription).name).toBe("subscription");
    expect("billingTierId" in schema.subscription).toBe(false);
    expect(schema.userStats.usageOwnerId).toBeDefined();
    expect(schema.userStats.billingReferenceId).toBeDefined();
    expect("customUsageLimit" in schema.userStats).toBe(false);
    expect("billingBlocked" in schema.userStats).toBe(false);

    const statsForeignKeys = getTableConfig(schema.userStats).foreignKeys;
    expect(
      statsForeignKeys.find((foreignKey) =>
        foreignKey.getName().includes("user_stats_user_id_user_id_fk")
      )?.onDelete
    ).toBe("set null");
    expect(
      statsForeignKeys.find((foreignKey) =>
        foreignKey.getName().includes("usage_owner_id")
      )?.onDelete
    ).toBe("restrict");
  });

  it("declares the finite key, immutable usage, completion, and singleton owners", () => {
    expect(schema.marketApiKeys.unkeyKeyId).toBeDefined();
    expect("secretHash" in schema.marketApiKeys).toBe(false);
    expect("rawKey" in schema.marketApiKeys).toBe(false);
    expect(schema.marketApiKeyCreationAttempts.providerDisplayValue).toBeDefined();
    expect(schema.marketApiUsageEvent.applicationUrl).toBeDefined();
    expect(schema.marketApiUsageCompletion.eventId).toBeDefined();
    expect("marketSystemState" in schema).toBe(false);

    const keyChecks = getTableConfig(schema.marketApiKeys).checks.map(
      (constraint) => constraint.name
    );
    expect(keyChecks).toContain("market_api_keys_spend_limit_check");
    expect(keyChecks).toContain("market_api_keys_provider_observation_check");

    const eventChecks = getTableConfig(schema.marketApiUsageEvent).checks.map(
      (constraint) => constraint.name
    );
    expect(eventChecks).toContain("market_api_usage_events_resource_check");
    expect(eventChecks).toContain("market_api_usage_events_billable_check");
    expect(eventChecks).toContain("market_api_usage_events_attribution_check");
  });
});
