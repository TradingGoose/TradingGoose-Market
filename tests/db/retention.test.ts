import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REQUIRED_CONTROL_DATABASE = "market_quality";
const GENERATED_DATABASE_PREFIX = "market_retention_";
const FORBIDDEN_CONTROL_DATABASES = new Set(["postgres", "template0", "template1"]);
const TEST_TIMEOUT_MS = 120_000;

const APPLICATION_ENVIRONMENT = {
  NEXT_PUBLIC_APP_URL: "http://market.test",
  BETTER_AUTH_URL: "http://market.test",
  BETTER_AUTH_SECRET: "e2994bae6c11ac37213199b5943a7b25c55e8366668169a0b99c49e53ae08827",
  REGISTRATION_MODE: "open",
  BILLING_ENABLED: "false",
  PAYG_USD_PER_1000_READS: "1.00",
  RESEND_API_KEY: "re_retention_test",
  RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
  UNKEY_API_ID: "api_retention_test",
  UNKEY_KEY_MANAGEMENT_ROOT_KEY: "unkey_retention_management",
  UNKEY_KEY_VERIFY_ROOT_KEY: "unkey_retention_verify",
} as const;

const CLEARED_APPLICATION_ENVIRONMENT = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "PAYG_STRIPE_PRICE_ID",
  "PAYG_INVOICE_THRESHOLD_USD",
  "RESEND_AUDIENCE_ID",
  "ANONYMOUS_RATE_LIMIT",
  "ANONYMOUS_RATE_LIMIT_DURATION_SECONDS",
  "UNKEY_ANONYMOUS_NAMESPACE_ID",
  "UNKEY_ANONYMOUS_RATELIMIT_ROOT_KEY",
  "DATABASE_POOL_URL",
] as const;

type DirectSql = ReturnType<typeof postgres>;
type EnvironmentSnapshot = Map<string, { present: boolean; value: string | undefined }>;

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseControlUrl(raw: string | undefined): URL {
  invariant(raw && raw.trim(), "DATABASE_URL must point to the market_quality control database.");
  const url = new URL(raw);
  invariant(
    url.protocol === "postgres:" || url.protocol === "postgresql:",
    "DATABASE_URL must be a PostgreSQL URL.",
  );
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  invariant(!FORBIDDEN_CONTROL_DATABASES.has(databaseName), "Refusing a protected PostgreSQL database.");
  invariant(
    databaseName === REQUIRED_CONTROL_DATABASE,
    `DATABASE_URL must target exactly ${REQUIRED_CONTROL_DATABASE}.`,
  );
  return url;
}

function generatedDatabaseUrl(controlUrl: URL, databaseName: string): string {
  invariant(
    new RegExp(`^${GENERATED_DATABASE_PREFIX}[a-f0-9]{32}$`, "u").test(databaseName),
    "Generated retention database name is outside the owned namespace.",
  );
  const target = new URL(controlUrl);
  target.pathname = `/${databaseName}`;
  return target.toString();
}

function installApplicationEnvironment(databaseUrl: string): EnvironmentSnapshot {
  const keys = [
    "DATABASE_URL",
    ...Object.keys(APPLICATION_ENVIRONMENT),
    ...CLEARED_APPLICATION_ENVIRONMENT,
  ];
  const snapshot = new Map(
    keys.map((key) => [
      key,
      { present: Object.hasOwn(process.env, key), value: process.env[key] },
    ]),
  );
  process.env.DATABASE_URL = databaseUrl;
  for (const [key, value] of Object.entries(APPLICATION_ENVIRONMENT)) process.env[key] = value;
  for (const key of CLEARED_APPLICATION_ENVIRONMENT) delete process.env[key];
  return snapshot;
}

function restoreEnvironment(snapshot: EnvironmentSnapshot): void {
  for (const [key, previous] of snapshot) {
    if (previous.present) process.env[key] = previous.value;
    else delete process.env[key];
  }
}

async function runStandardMigration(databaseUrl: string): Promise<void> {
  await new Promise<void>((resolveMigration, rejectMigration) => {
    const child = spawn("bun", ["run", "db:migrate"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", rejectMigration);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveMigration();
      else {
        rejectMigration(
          new Error(
            `bun run db:migrate failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.\n${output}`,
          ),
        );
      }
    });
  });
}

describe.sequential("v1 retained customer usage", () => {
  it(
    "retains the exact owner, accumulator, subscription, key tombstone, and event audit",
    async () => {
      const controlUrl = parseControlUrl(process.env.DATABASE_URL);
      const databaseName = `${GENERATED_DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;
      const targetUrl = generatedDatabaseUrl(controlUrl, databaseName);
      const controlSql = postgres(controlUrl.toString(), { max: 1 });
      let targetSql: DirectSql | null = null;
      let applicationClient: DirectSql | null = null;
      let environmentSnapshot: EnvironmentSnapshot | null = null;
      let databaseCreated = false;

      try {
        const [controlIdentity] = await controlSql<{
          database_name: string;
          user_name: string;
        }[]>`
          select current_database() as database_name, current_user as user_name
        `;
        expect(controlIdentity).toEqual({
          database_name: REQUIRED_CONTROL_DATABASE,
          user_name: "market",
        });

        await controlSql.unsafe(`create database "${databaseName}" owner market`);
        databaseCreated = true;
        targetSql = postgres(targetUrl, { max: 2 });

        try {
          await runStandardMigration(targetUrl);
          environmentSnapshot = installApplicationEnvironment(targetUrl);
          vi.resetModules();

          const databaseRuntime = await import("../../lib/db/runtime");
          const database = databaseRuntime.requireDatabase();
          const { schema } = await import("@tradinggoose/db");
          applicationClient = database.$client;
          const { ensureMarketCustomerState } = await import("../../lib/billing/customer-state");

          const retainedUserId = `retained_${randomUUID()}`;
          const otherUserId = `other_${randomUUID()}`;
          const now = new Date();
          await targetSql`
            insert into "user" (
              id, name, email, email_verified, image, created_at, updated_at
            ) values
              (
                ${retainedUserId}, 'Retained Customer', ${`${retainedUserId}@example.com`},
                true, null, ${now}, ${now}
              ),
              (
                ${otherUserId}, 'Other Customer', ${`${otherUserId}@example.com`},
                true, null, ${now}, ${now}
              )
          `;

          const retainedState = await ensureMarketCustomerState(retainedUserId, database);
          const otherState = await ensureMarketCustomerState(otherUserId, database);
          expect((await ensureMarketCustomerState(retainedUserId, database)).userStats.id).toBe(
            retainedState.userStats.id,
          );
          expect((await ensureMarketCustomerState(otherUserId, database)).userStats.id).toBe(
            otherState.userStats.id,
          );

          const keyId = `key_${randomUUID()}`;
          const providerKeyId = `provider_${randomUUID()}`;
          const eventId = `event_${randomUUID()}`;
          await targetSql`
            insert into market_api_keys (
              id, usage_owner_id, user_id, unkey_key_id, key_class, name,
              display_value, spend_limit_revision, spend_limit_updated_at
            ) values (
              ${keyId}, ${retainedState.usageOwner.id}, ${retainedUserId}, ${providerKeyId},
              'public', 'Retained key', 'tg_pub_retained', 1, ${now}
            )
          `;
          await targetSql`
            insert into market_api_usage_events (
              id, usage_owner_id, market_api_key_id, key_class, route_id, category,
              resource_id, method, api_version, billing_mode, billable_quantity,
              rate_usd_per_1000_reads, billable_cost_usd, application_url, application_title
            ) values (
              ${eventId}, ${retainedState.usageOwner.id}, ${keyId}, 'public',
              'public.search', 'public.search', 'market_instrument', 'GET', 'v1',
              'enabled', 1, 1.00, 0.001, 'https://studio.tradinggoose.com', 'TradingGoose Studio'
            )
          `;
          await targetSql`
            insert into market_api_usage_completions (event_id, result_class, http_status)
            values (${eventId}, 'success', 200)
          `;
          await targetSql`
            update user_stats
            set
              total_request_quantity = 1,
              current_period_request_quantity = 1,
              total_cost = 0.001,
              current_period_cost = 0.001,
              updated_at = ${now}
            where id = ${retainedState.userStats.id}
          `;
          await targetSql`
            update subscription
            set
              stripe_customer_id = 'cus_retained',
              stripe_subscription_id = 'sub_retained_provider',
              status = 'canceled',
              period_start = ${new Date("2026-07-01T00:00:00.000Z")},
              period_end = ${new Date("2026-08-01T00:00:00.000Z")}
            where id = ${retainedState.subscription.id}
          `;

          await targetSql`delete from "user" where id = ${retainedUserId}`;

          const [retained] = await targetSql<{
            owner_id: string;
            owner_user_id: string | null;
            stats_id: string;
            stats_user_id: string | null;
            usage_owner_id: string;
            billing_reference_id: string;
            key_id: string;
            key_user_id: string | null;
            event_id: string;
            completion_event_id: string;
            subscription_reference_id: string;
          }[]>`
            select
              owner.id as owner_id,
              owner.user_id as owner_user_id,
              stats.id as stats_id,
              stats.user_id as stats_user_id,
              stats.usage_owner_id,
              stats.billing_reference_id,
              key.id as key_id,
              key.user_id as key_user_id,
              event.id as event_id,
              completion.event_id as completion_event_id,
              subscription.reference_id as subscription_reference_id
            from market_usage_owner owner
            join user_stats stats on stats.usage_owner_id = owner.id
            join market_api_keys key on key.usage_owner_id = owner.id
            join market_api_usage_events event on event.market_api_key_id = key.id
            join market_api_usage_completions completion on completion.event_id = event.id
            join subscription
              on subscription.reference_type = 'user'
              and subscription.reference_id = stats.billing_reference_id
              and subscription.plan = 'payg'
            where owner.id = ${retainedState.usageOwner.id}
          `;
          expect(retained).toEqual({
            owner_id: retainedState.usageOwner.id,
            owner_user_id: null,
            stats_id: retainedState.userStats.id,
            stats_user_id: null,
            usage_owner_id: retainedState.usageOwner.id,
            billing_reference_id: retainedUserId,
            key_id: keyId,
            key_user_id: null,
            event_id: eventId,
            completion_event_id: eventId,
            subscription_reference_id: retainedUserId,
          });

          const [other] = await targetSql<{
            owner_user_id: string | null;
            stats_user_id: string | null;
            billing_reference_id: string;
            total_request_quantity: string;
          }[]>`
            select
              owner.user_id as owner_user_id,
              stats.user_id as stats_user_id,
              stats.billing_reference_id,
              stats.total_request_quantity
            from market_usage_owner owner
            join user_stats stats on stats.usage_owner_id = owner.id
            where owner.id = ${otherState.usageOwner.id}
          `;
          expect(other).toEqual({
            owner_user_id: otherUserId,
            stats_user_id: otherUserId,
            billing_reference_id: otherUserId,
            total_request_quantity: "0",
          });

          const [localSubscription] = await database
            .select()
            .from(schema.subscription)
            .where(
              and(
                eq(schema.subscription.referenceType, "user"),
                eq(schema.subscription.referenceId, retainedUserId),
                eq(schema.subscription.plan, "payg"),
              ),
            )
            .limit(1);
          invariant(localSubscription, "Retained PAYG subscription is missing.");
          const { resolveRetainedUserStatsForSubscription } = await import(
            "../../lib/billing/user-stats"
          );
          const resolvedOnce = await resolveRetainedUserStatsForSubscription(
            localSubscription,
            database,
          );
          const resolvedAgain = await resolveRetainedUserStatsForSubscription(
            localSubscription,
            database,
          );
          expect(resolvedOnce.id).toBe(retainedState.userStats.id);
          expect(resolvedAgain.id).toBe(retainedState.userStats.id);
          expect(resolvedAgain.userId).toBeNull();
          expect(resolvedAgain.usageOwnerId).toBe(retainedState.usageOwner.id);
          expect(resolvedAgain.billingReferenceId).toBe(retainedUserId);

          vi.doMock("@/lib/unkey/runtime", () => ({
            getMarketKeyProvider: () => ({
              verifyKey: async () => ({
                valid: true,
                code: "VALID",
                keyId: providerKeyId,
                permissions: ["market.public"],
                ratelimits: [],
              }),
            }),
          }));
          const { handleKeyedMarketRoute } = await import("../../lib/market-api/core/access");
          const { resolveKeyedMarketRoute } = await import("../../lib/market-api/core/manifest");
          const descriptor = resolveKeyedMarketRoute("/api/search");
          invariant(descriptor, "Public search descriptor is missing.");
          const handler = vi.fn(async () => Response.json({ data: [] }));
          const denial = await handleKeyedMarketRoute(
            new Request("http://market.test/api/search?version=v1", {
              headers: { "x-api-key": "tg_pub_deleted_owner" },
            }),
            descriptor,
            handler,
          );
          expect(denial.status).toBe(403);
          expect(await denial.json()).toMatchObject({ code: "API_KEY_FORBIDDEN" });
          expect(handler).not.toHaveBeenCalled();

          const [audit] = await targetSql<{
            route_id: string;
            billable_quantity: number;
            billable_cost_usd: string;
            result_class: string;
            http_status: number;
          }[]>`
            select
              event.route_id,
              event.billable_quantity,
              event.billable_cost_usd,
              completion.result_class,
              completion.http_status
            from market_api_usage_events event
            join market_api_usage_completions completion on completion.event_id = event.id
            where event.id = ${eventId}
          `;
          expect(audit).toEqual({
            route_id: "public.search",
            billable_quantity: 1,
            billable_cost_usd: "0.001",
            result_class: "success",
            http_status: 200,
          });
        } finally {
          try {
            if (applicationClient) await applicationClient.end({ timeout: 5 });
          } finally {
            try {
              if (targetSql) await targetSql.end({ timeout: 5 });
            } finally {
              if (environmentSnapshot) restoreEnvironment(environmentSnapshot);
              vi.doUnmock("@/lib/unkey/runtime");
              vi.resetModules();
            }
          }
        }
      } finally {
        try {
          if (databaseCreated) {
            await controlSql`
              select pg_terminate_backend(pid)
              from pg_catalog.pg_stat_activity
              where datname = ${databaseName} and pid <> pg_backend_pid()
            `;
            await controlSql.unsafe(`drop database "${databaseName}"`);
          }
        } finally {
          await controlSql.end({ timeout: 5 });
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});
