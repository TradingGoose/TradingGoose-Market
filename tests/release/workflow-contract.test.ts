import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflow = read(".github/workflows/release.yml");
const vitestConfig = read("vitest.config.ts");
const harness = read("tests/release/production-server-smoke.ts");
const freshDatabaseTest = read("tests/db/fresh-database-migration.test.ts");
const packageJson = JSON.parse(read("package.json")) as {
  scripts: Record<string, string>;
};

function read(path: string): string {
  return readFileSync(resolve(PROJECT_ROOT, path), "utf8");
}

function jobBlock(name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) throw new Error(`Missing workflow job ${name}.`);
  const contentStart = start + marker.length;
  const next = /\n  [a-z][a-z0-9-]*:\n/iu.exec(workflow.slice(contentStart));
  return workflow.slice(start, next ? contentStart + next.index : workflow.length);
}

function runSteps(block: string): string[] {
  return [...block.matchAll(/^\s+- run: ([^\n]+)$/gmu)].map((match) => match[1]);
}

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("release workflow contract", () => {
  it("keeps independent quality and release-validation PostgreSQL 17 jobs", () => {
    const quality = jobBlock("quality");
    const validation = jobBlock("release-validation");

    expect(quality).not.toContain("needs:");
    expect(validation).not.toContain("needs:");
    expect(quality).toContain("image: postgres:17");
    expect(quality).toContain("POSTGRES_USER: market");
    expect(quality).toContain("POSTGRES_PASSWORD: market");
    expect(quality).toContain("POSTGRES_DB: market_quality");
    expect(quality).toContain("- 5432:5432");
    expect(quality).toContain('pg_isready -U market -d market_quality');
    expect(occurrences(quality, "postgres://market:market@127.0.0.1:5432/market_quality")).toBe(1);
    expect(runSteps(quality)).toEqual([
      "bun install --frozen-lockfile",
      "bun run db:build",
      "bun run type-check",
      "bun run lint",
      "bun run test",
    ]);
    expect(quality).toMatch(
      /- run: bun run test\n\s+env:\n\s+DATABASE_URL: postgres:\/\/market:market@127\.0\.0\.1:5432\/market_quality/u,
    );

    expect(validation).toContain("image: postgres:17");
    expect(validation).toContain("POSTGRES_USER: market");
    expect(validation).toContain("POSTGRES_PASSWORD: market");
    expect(validation).toContain("POSTGRES_DB: market_release");
    expect(validation).toContain("- 5432:5432");
    expect(validation).toContain('pg_isready -U market -d market_release');
    expect(runSteps(validation)).toEqual([
      "bun install --frozen-lockfile",
      "bun run db:build",
      "bun run db:migrate",
      "bun run test:release",
    ]);
    expect(occurrences(validation, "bun run db:migrate")).toBe(1);
    expect(occurrences(validation, "bun run test:release")).toBe(1);
    expect(validation).not.toMatch(/- run: bun run test$/mu);
    expect(validation).not.toContain("tests/db/");
    expect(validation).not.toContain("vitest");
    expect(occurrences(validation, "postgres://market:market@127.0.0.1:5432/market_release")).toBe(2);
  });

  it("supplies only the shared release base and gates publication on both jobs", () => {
    const validation = jobBlock("release-validation");
    const release = jobBlock("release");
    for (const key of [
      "DATABASE_URL",
      "NEXT_PUBLIC_APP_URL",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_SECRET",
      "PAYG_USD_PER_1000_READS",
      "UNKEY_API_ID",
      "UNKEY_KEY_MANAGEMENT_ROOT_KEY",
      "UNKEY_KEY_VERIFY_ROOT_KEY",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
    ]) {
      expect(validation).toContain(`${key}:`);
    }
    expect(validation).toContain("NEXT_PUBLIC_APP_URL: https://127.0.0.1:3000");
    expect(validation).toContain("BETTER_AUTH_URL: https://127.0.0.1:3000");
    const authSecretLine = validation
      .split("\n")
      .find((line) => line.trimStart().startsWith("BETTER_AUTH_SECRET:"));
    expect(authSecretLine).toBeDefined();
    const authSecret = authSecretLine
      ?.slice(authSecretLine.indexOf(":") + 1)
      .trim()
      .replace(/^["']|["']$/gu, "") ?? "";
    expect(authSecret).toMatch(/^[0-9a-f]{64}$/u);
    expect(authSecret).not.toMatch(/^([0-9a-f])\1{63}$/u);
    for (const publicPlaceholder of [
      "release-validation-secret-that-is-long-enough",
      "replace-with-a-long-random-server-secret",
      "replace-with-64-lowercase-hex-characters",
    ]) {
      expect(validation).not.toContain(publicPlaceholder);
    }
    for (const forbidden of [
      "REGISTRATION_MODE",
      "BILLING_ENABLED",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "PAYG_STRIPE_PRICE_ID",
      "PAYG_INVOICE_THRESHOLD_USD",
      "RESEND_AUDIENCE_ID",
      "ANONYMOUS_RATE_LIMIT",
      "ANONYMOUS_RATE_LIMIT_DURATION_SECONDS",
      "UNKEY_ANONYMOUS_NAMESPACE_ID",
      "UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY",
    ]) {
      expect(validation).not.toContain(forbidden);
    }
    expect(release).toMatch(/^\n  release:\n\s+needs: \[quality, release-validation\]/u);
  });

  it("removes every old workflow and parallel migration owner", () => {
    for (const forbidden of [
      "database-transition",
      "production-build",
      "strategy:",
      "matrix:",
      "db:migrate:standalone",
      "test:release:database",
      "DATABASE_POOL_URL",
    ]) {
      expect(workflow).not.toContain(forbidden);
    }
    expect(vitestConfig).not.toMatch(/tests\/release|tests\/db|workflow-contract/iu);
    expect(existsSync(resolve(PROJECT_ROOT, "vitest.release.config.ts"))).toBe(false);
    expect(existsSync(resolve(PROJECT_ROOT, "tests/release/standalone-database.release.test.ts"))).toBe(false);
  });

  it("pins the canonical package commands", () => {
    expect(packageJson.scripts.test).toBe("bun run db:build && vitest run");
    expect(packageJson.scripts["db:migrate"]).toBe("bun run --cwd ./packages/db db:migrate");
    expect(packageJson.scripts["test:release"]).toBe(
      "bun run tests/release/production-server-smoke.ts",
    );
    expect(packageJson.scripts["test:release:database"]).toBeUndefined();
    expect(packageJson.scripts["db:migrate:standalone"]).toBeUndefined();
    expect(Object.keys(packageJson.scripts).some((name) => name.startsWith("test:db:"))).toBe(false);

    const databasePackage = JSON.parse(read("packages/db/package.json")) as {
      scripts: Record<string, string>;
    };
    expect(databasePackage.scripts.build).toBe(
      "rm -rf ./dist && tsc -p tsconfig.build.json",
    );
    expect(databasePackage.scripts["db:migrate"]).toBe(
      "bunx drizzle-kit migrate --config=./drizzle.config.ts",
    );
  });

  it("keeps the four-mode build/start smoke as the sole release harness owner", () => {
    expect(
      [...harness.matchAll(/\{ registrationMode: "(open|close)", billingEnabled: (true|false) \}/gu)]
        .map((match) => `${match[1]}/${match[2]}`),
    ).toEqual(["open/true", "close/true", "close/false", "open/false"]);
    for (const key of [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "PAYG_STRIPE_PRICE_ID",
      "PAYG_INVOICE_THRESHOLD_USD",
      "RESEND_AUDIENCE_ID",
      "ANONYMOUS_RATE_LIMIT",
      "ANONYMOUS_RATE_LIMIT_DURATION_SECONDS",
      "UNKEY_ANONYMOUS_NAMESPACE_ID",
      "UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY",
    ]) {
      expect(harness).toMatch(new RegExp(`delete environment\\[key\\]|"${key}"`, "u"));
    }
    expect(harness).toContain('environment.STRIPE_SECRET_KEY = "sk_test_release_validation"');
    expect(harness).toContain('environment.STRIPE_WEBHOOK_SECRET = "whsec_release_validation"');
    expect(harness).toContain('environment.PAYG_STRIPE_PRICE_ID = "price_release_validation"');
    expect(harness).toContain('environment.PAYG_INVOICE_THRESHOLD_USD = "50"');
    expect(harness).toContain('await rm(NEXT_BUILD_DIRECTORY, { recursive: true, force: true');
    expect(harness).toContain('await runCommand("bun", ["run", "build"]');
    expect(harness).toContain('"node_modules/next/dist/bin/next", "start"');
    expect(harness).toContain('request(target, "/api/health", "GET")');
    expect(harness).toContain('appUrl.protocol === "https:"');
    expect(harness).toContain('serverOrigin.protocol = "http:"');
    expect(harness).toContain('headers.set("x-forwarded-proto"');
    expect(harness).toContain('headers.set("x-forwarded-host"');
    expect(harness).toContain('headers.set("x-forwarded-port"');
    expect(harness).toContain("async function smokeCanonicalRedirect");
    expect(harness).toContain("canonical: false");
    expect(harness).toContain("async function smokeAllowedOwners");
    expect(harness).toContain('"OPTIONS"');
    expect(harness).toContain('"/api/search/cities?version=v1&city_name=release-smoke-no-match-7f70b2"');
    expect(harness).toContain('"/api/auth/get-session"');
    expect(harness).toContain('"/api/billing/stripe/webhook"');
    expect(harness).toMatch(/async function smokeRetainedOwners\([\s\S]*?mode: \(typeof MARKET_RELEASE_MODES\)\[number\]/u);
    expect(harness).toContain('request(target, "/signup", "GET")');
    expect(harness).toContain('mode.registrationMode === "open" ? 200 : 404');
    expect(harness).toContain("await smokeRetainedOwners(target, mode)");
    expect(harness).toContain("async function smokeRegistrationPolicy");
    expect(harness).toContain("await smokeRegistrationPolicy(target, mode)");
    expect(harness).toContain('mode.registrationMode === "open" && mode.billingEnabled');
    expect(harness).toContain('body: JSON.stringify(RELEASE_SIGNUP)');
    expect(harness).toContain('origin: target.publicOrigin.origin');
    expect(harness).toContain('"sec-fetch-site": "same-origin"');
    expect(harness).toContain('response.status === 403');
    expect(harness).toContain('payload.code === "REGISTRATION_CLOSED"');
    expect(harness).toContain('payload.message === "REGISTRATION_CLOSED"');
    expect(harness).toContain('!mode.billingEnabled');
    expect(harness).toContain('response.status === 200');
    expect(harness).toContain('payload.token === null');
    expect(harness).toContain('payload.user?.name === RELEASE_SIGNUP.name');
    expect(harness).toContain('payload.user.email === RELEASE_SIGNUP.email');
    expect(harness).toContain('payload.user.emailVerified === false');
    expect(harness).toContain('payload.user.image === null');
    expect(harness).toContain("for (const descriptor of MARKET_API_ROUTE_MANIFEST)");
    expect(harness).toMatch(/try \{[\s\S]*smokeExactManifest[\s\S]*\} finally \{\n\s+await terminateServer/u);
    expect(harness).toContain("export async function runMarketReleaseValidationMatrix");
    expect(harness).toContain("void runMarketReleaseValidationMatrix().catch");
    expect(harness).not.toContain("db:migrate");
  });

  it("keeps fresh migration validation on the exact root command and generated database", () => {
    expect(freshDatabaseTest).toContain('const REQUIRED_CONTROL_DATABASE = "market_quality"');
    expect(freshDatabaseTest).toContain('const GENERATED_DATABASE_PREFIX = "market_fresh_"');
    expect(freshDatabaseTest).toContain('spawn("bun", ["run", "db:migrate"]');
    expect(occurrences(freshDatabaseTest, 'spawn("bun", ["run", "db:migrate"]')).toBe(1);
    expect(freshDatabaseTest).toContain("vi.resetModules()");
    expect(freshDatabaseTest).toContain('await import("../../lib/db/runtime")');
    expect(freshDatabaseTest).toContain("databaseRuntime.requireDatabase()");
    expect(freshDatabaseTest).toContain('await import("../../app/api/auth/[...all]/route")');
    expect(freshDatabaseTest).not.toMatch(
      /^import .*(@tradinggoose\/db|@\/lib\/environment|lib\/auth|customer-state)/mu,
    );
  });

  it("documents only the empty-database, direct-Resend release path", () => {
    const documentation = `${read("README.md")}\n${read(".github/CONTRIBUTING.md")}`;
    for (const forbidden of [
      "db:migrate:standalone",
      "test:release:database",
      "standalone-v1/ready",
    ]) {
      expect(documentation).not.toContain(forbidden);
    }
    for (const required of [
      "bun run db:migrate",
      "bun run test:release",
      "RESEND_API_KEY",
      "RESEND_FROM_EMAIL",
      "RESEND_AUDIENCE_ID",
      "newly initialized empty",
      "bun run admin:manage add",
    ]) {
      expect(documentation).toContain(required);
    }
  });
});
