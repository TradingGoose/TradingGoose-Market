import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../../packages/db/schema";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("Better Auth email-change identity lifecycle", () => {
  it("pins the patched verified-change owner to immutable identity and a consumed challenge", () => {
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
      "internalAdapter.updateUser(currentUser.id",
    );
    expect(verifiedChangeBranch).toContain("runWithTransaction");
    expect(verifiedChangeBranch).toContain("currentUser.email !== parsed.email");
    expect(verifiedChangeBranch).toContain("pending.value !== token");
    expect(verifiedChangeBranch).toContain("deleteVerificationByIdentifier(identifier)");
    expect(verifiedChangeBranch).toContain('for (const type of ["sign-in", "email-verification", "forget-password"])');
    expect(verifiedChangeBranch).toContain('value: currentUser.id');
    expect(verifiedChangeBranch).toContain('operator: "starts_with", value: "reset-password:"');
    expect(verifiedChangeBranch).toContain('if (!result) return redirectOnError("invalid_token")');
    expect(source).toContain("internalAdapter.findUserById(parsed.userId)");
    expect(verifiedChangeBranch).toContain("email: parsed.updateTo");
    expect(verifiedChangeBranch).toContain("emailVerified: true");
    expect(verifiedChangeBranch).not.toContain("createUser");
    expect(verifiedChangeBranch).not.toContain("deleteUser");
  });

  it("serializes OTP attempt counters and commits failures before reporting them", () => {
    const source = readFileSync(
      `${projectRoot}/node_modules/better-auth/dist/plugins/email-otp/routes.mjs`, "utf8",
    );
    const signIn = source.slice(source.indexOf("const signInEmailOTP ="), source.indexOf("const requestPasswordResetEmailOTPBodySchema"));
    expect(signIn).toContain("runWithTransaction");
    expect(signIn).toContain("internalAdapter.updateUser(user.user.id");
    expect(signIn).toContain('where: [{ field: "id", value: candidate.id }]');
    expect(signIn).toContain('return { error: ERROR_CODES.INVALID_OTP, status: "BAD_REQUEST" }');
    expect(signIn.indexOf("if (result.error) throw new APIError")).toBeGreaterThan(
      signIn.indexOf("return { session, user: user.user }"),
    );
    expect(signIn).not.toContain('field: "value", value: verificationValue.value');
    expect(signIn.indexOf("await setSessionCookie")).toBeGreaterThan(signIn.indexOf("if (result.error)"));
  });

  it("serializes reset issuance and one-time redemption with identity changes", () => {
    const source = readFileSync(
      `${projectRoot}/node_modules/better-auth/dist/api/routes/password.mjs`, "utf8",
    );
    expect(source).toContain("const issued = await runWithTransaction");
    expect(source).toContain("currentUser.email !== user.user.email");
    expect(source).toContain("const reset = await runWithTransaction");
    expect(source).toContain("currentVerification.id !== verification.id");
    expect(source).toContain("currentVerification.value !== userId");
    const patch = readFileSync(`${projectRoot}/patches/better-auth@1.4.18.patch`, "utf8");
    expect(patch).toContain("+++ b/dist/api/routes/password.mjs");
    expect(patch).not.toContain(".bun-tag-");
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
