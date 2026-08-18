import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../../packages/db/schema";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("Better Auth email-change identity lifecycle", () => {
  it("pins the installed verified-change branch to an in-place user-row update", () => {
    const packageJson = JSON.parse(
      readFileSync(`${projectRoot}/node_modules/better-auth/package.json`, "utf8"),
    ) as { version: string };
    const source = readFileSync(
      `${projectRoot}/node_modules/better-auth/dist/api/routes/email-verification.mjs`,
      "utf8",
    );
    const branchStart = source.indexOf('case "change-email-verification"');
    const branchEnd = source.indexOf("\n\t\t\tdefault:", branchStart);
    const verifiedChangeBranch = source.slice(branchStart, branchEnd);

    expect(packageJson.version).toBe("1.4.18");
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    expect(verifiedChangeBranch).toContain(
      "internalAdapter.updateUserByEmail(parsed.email",
    );
    expect(verifiedChangeBranch).toContain("email: parsed.updateTo");
    expect(verifiedChangeBranch).toContain("emailVerified: true");
    expect(verifiedChangeBranch).not.toContain("createUser");
    expect(verifiedChangeBranch).not.toContain("deleteUser");
  });

  it("keeps every Market entitlement and history relationship keyed by identity IDs, never email", () => {
    const identityTables = [
      schema.systemAdmin,
      schema.marketUsageOwner,
      schema.userStats,
      schema.marketApiKeys,
      schema.subscription,
      schema.marketApiUsageEvent,
      schema.marketApiUsageCompletion,
    ];

    for (const table of identityTables) {
      const config = getTableConfig(table);
      expect(config.columns.map((column) => column.name)).not.toContain("email");
    }

    expect(schema.systemAdmin.userId).toBeDefined();
    expect(schema.marketUsageOwner.userId).toBeDefined();
    expect(schema.userStats.userId).toBeDefined();
    expect(schema.userStats.usageOwnerId).toBeDefined();
    expect(schema.marketApiKeys.userId).toBeDefined();
    expect(schema.marketApiKeys.usageOwnerId).toBeDefined();
    expect(schema.subscription.referenceId).toBeDefined();
    expect(schema.marketApiUsageEvent.usageOwnerId).toBeDefined();
    expect(schema.marketApiUsageCompletion.eventId).toBeDefined();
  });
});
