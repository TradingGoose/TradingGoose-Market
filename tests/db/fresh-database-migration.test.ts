import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SNAPSHOT_PATH = resolve(
  PROJECT_ROOT,
  "packages/db/migrations/meta/0008_snapshot.json",
);
const REQUIRED_CONTROL_DATABASE = "market_quality";
const GENERATED_DATABASE_PREFIX = "market_fresh_";
const FORBIDDEN_CONTROL_DATABASES = new Set(["postgres", "template0", "template1"]);
const TEST_TIMEOUT_MS = 120_000;

const APPLICATION_ENVIRONMENT = {
  NEXT_PUBLIC_APP_URL: "http://market.test",
  BETTER_AUTH_URL: "http://market.test",
  BETTER_AUTH_SECRET: "e68ad965b50e6c301b5ae37a80b8196934237ae718548b83c098e4609786808e",
  REGISTRATION_MODE: "open",
  BILLING_ENABLED: "false",
  PAYG_USD_PER_1000_READS: "1.00",
  RESEND_API_KEY: "re_fresh_database_test",
  RESEND_FROM_EMAIL: "TradingGoose Market <market@example.com>",
  UNKEY_API_ID: "api_fresh_database_test",
  UNKEY_KEY_MANAGEMENT_ROOT_KEY: "unkey_fresh_database_management",
  UNKEY_KEY_VERIFY_ROOT_KEY: "unkey_fresh_database_verify",
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
type DrizzleSnapshot = {
  tables: Record<string, SnapshotTable>;
};
type SnapshotTable = {
  name: string;
  schema: string;
  columns: Record<
    string,
    { name: string; type: string; primaryKey: boolean; notNull: boolean }
  >;
  indexes: Record<string, { name: string }>;
  foreignKeys: Record<
    string,
    {
      name: string;
      tableFrom: string;
      tableTo: string;
      onDelete?: string;
      onUpdate?: string;
    }
  >;
  compositePrimaryKeys: Record<string, { name: string }>;
  uniqueConstraints: Record<string, { name: string }>;
  checkConstraints: Record<string, { name: string }>;
};

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
    "Generated database name is outside the owned namespace.",
  );
  const target = new URL(controlUrl);
  target.pathname = `/${databaseName}`;
  return target.toString();
}

function captureEnvironment(keys: readonly string[]): EnvironmentSnapshot {
  return new Map(
    keys.map((key) => [
      key,
      {
        present: Object.hasOwn(process.env, key),
        value: process.env[key],
      },
    ]),
  );
}

function restoreEnvironment(snapshot: EnvironmentSnapshot): void {
  for (const [key, previous] of snapshot) {
    if (previous.present) process.env[key] = previous.value;
    else delete process.env[key];
  }
}

function installApplicationEnvironment(databaseUrl: string): EnvironmentSnapshot {
  const keys = [
    "DATABASE_URL",
    ...Object.keys(APPLICATION_ENVIRONMENT),
    ...CLEARED_APPLICATION_ENVIRONMENT,
  ];
  const snapshot = captureEnvironment(keys);
  process.env.DATABASE_URL = databaseUrl;
  for (const [key, value] of Object.entries(APPLICATION_ENVIRONMENT)) {
    process.env[key] = value;
  }
  for (const key of CLEARED_APPLICATION_ENVIRONMENT) delete process.env[key];
  return snapshot;
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

async function assertInitiallyEmpty(sql: DirectSql): Promise<void> {
  const relations = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    order by c.relname
  `;
  const routines = await sql<{ name: string }[]>`
    select p.proname as name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `;
  expect(relations).toEqual([]);
  expect(routines).toEqual([]);
}

function snapshotTables(snapshot: DrizzleSnapshot): SnapshotTable[] {
  return Object.values(snapshot.tables)
    .filter((table) => table.schema === "" || table.schema === "public")
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function assertCatalogMatchesGeneratedSnapshot(
  sql: DirectSql,
  snapshot: DrizzleSnapshot,
): Promise<void> {
  const tables = snapshotTables(snapshot);
  const expectedTableNames = tables.map((table) => table.name);
  const actualTables = await sql<{ table_name: string }[]>`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  expect(actualTables.map((row) => row.table_name)).toEqual(expectedTableNames);

  const expectedColumns = tables
    .flatMap((table) =>
      Object.values(table.columns).map((column) => ({
        table_name: table.name,
        column_name: column.name,
        data_type: column.type,
        not_null: column.notNull,
      })),
    )
    .sort((left, right) =>
      `${left.table_name}.${left.column_name}`.localeCompare(`${right.table_name}.${right.column_name}`),
    );
  const actualColumns = await sql<{
    table_name: string;
    column_name: string;
    data_type: string;
    not_null: boolean;
  }[]>`
    select
      c.relname as table_name,
      a.attname as column_name,
      pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
      a.attnotnull as not_null
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and a.attnum > 0
      and not a.attisdropped
    order by c.relname, a.attname
  `;
  actualColumns.sort((left, right) =>
    `${left.table_name}.${left.column_name}`.localeCompare(`${right.table_name}.${right.column_name}`),
  );
  expect(actualColumns).toEqual(expectedColumns);

  const expectedConstraints = tables
    .flatMap((table) => {
      const singlePrimaryKey = Object.values(table.columns).some((column) => column.primaryKey)
        ? [{ table_name: table.name, constraint_name: `${table.name}_pkey`, constraint_type: "p" }]
        : [];
      return [
        ...singlePrimaryKey,
        ...Object.values(table.compositePrimaryKeys).map((constraint) => ({
          table_name: table.name,
          constraint_name: constraint.name,
          constraint_type: "p",
        })),
        ...Object.values(table.uniqueConstraints).map((constraint) => ({
          table_name: table.name,
          constraint_name: constraint.name,
          constraint_type: "u",
        })),
        ...Object.values(table.foreignKeys).map((constraint) => ({
          table_name: table.name,
          constraint_name: constraint.name,
          constraint_type: "f",
        })),
        ...Object.values(table.checkConstraints).map((constraint) => ({
          table_name: table.name,
          constraint_name: constraint.name,
          constraint_type: "c",
        })),
      ];
    })
    .sort((left, right) =>
      `${left.table_name}.${left.constraint_name}`.localeCompare(
        `${right.table_name}.${right.constraint_name}`,
      ),
    );
  const actualConstraints = await sql<{
    table_name: string;
    constraint_name: string;
    constraint_type: string;
  }[]>`
    select
      c.relname as table_name,
      constraint_record.conname as constraint_name,
      constraint_record.contype::text as constraint_type
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class c on c.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and constraint_record.contype in ('p', 'u', 'f', 'c')
    order by c.relname, constraint_record.conname
  `;
  actualConstraints.sort((left, right) =>
    `${left.table_name}.${left.constraint_name}`.localeCompare(
      `${right.table_name}.${right.constraint_name}`,
    ),
  );
  expect(actualConstraints).toEqual(expectedConstraints);

  const constraintIndexNames = expectedConstraints
    .filter((constraint) => constraint.constraint_type === "p" || constraint.constraint_type === "u")
    .map((constraint) => ({
      table_name: constraint.table_name,
      index_name: constraint.constraint_name,
    }));
  const expectedIndexes = [
    ...tables.flatMap((table) =>
      Object.values(table.indexes).map((index) => ({
        table_name: table.name,
        index_name: index.name,
      })),
    ),
    ...constraintIndexNames,
  ].sort((left, right) =>
    `${left.table_name}.${left.index_name}`.localeCompare(`${right.table_name}.${right.index_name}`),
  );
  const actualIndexes = await sql<{ table_name: string; index_name: string }[]>`
    select table_record.relname as table_name, index_record.relname as index_name
    from pg_catalog.pg_index index_catalog
    join pg_catalog.pg_class table_record on table_record.oid = index_catalog.indrelid
    join pg_catalog.pg_class index_record on index_record.oid = index_catalog.indexrelid
    join pg_catalog.pg_namespace n on n.oid = table_record.relnamespace
    where n.nspname = 'public'
    order by table_record.relname, index_record.relname
  `;
  actualIndexes.sort((left, right) =>
    `${left.table_name}.${left.index_name}`.localeCompare(`${right.table_name}.${right.index_name}`),
  );
  expect(actualIndexes).toEqual(expectedIndexes);

  const expectedForeignKeys = tables
    .flatMap((table) =>
      Object.values(table.foreignKeys).map((foreignKey) => ({
        constraint_name: foreignKey.name,
        table_from: foreignKey.tableFrom,
        table_to: foreignKey.tableTo,
        on_delete: foreignKey.onDelete ?? "no action",
        on_update: foreignKey.onUpdate ?? "no action",
      })),
    )
    .sort((left, right) => left.constraint_name.localeCompare(right.constraint_name));
  const actualForeignKeys = await sql<{
    constraint_name: string;
    table_from: string;
    table_to: string;
    on_delete: string;
    on_update: string;
  }[]>`
    select
      constraint_record.conname as constraint_name,
      source_table.relname as table_from,
      target_table.relname as table_to,
      case constraint_record.confdeltype
        when 'a' then 'no action'
        when 'r' then 'restrict'
        when 'c' then 'cascade'
        when 'n' then 'set null'
        when 'd' then 'set default'
      end as on_delete,
      case constraint_record.confupdtype
        when 'a' then 'no action'
        when 'r' then 'restrict'
        when 'c' then 'cascade'
        when 'n' then 'set null'
        when 'd' then 'set default'
      end as on_update
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class source_table on source_table.oid = constraint_record.conrelid
    join pg_catalog.pg_class target_table on target_table.oid = constraint_record.confrelid
    join pg_catalog.pg_namespace n on n.oid = source_table.relnamespace
    where n.nspname = 'public' and constraint_record.contype = 'f'
    order by constraint_record.conname
  `;
  expect(actualForeignKeys).toEqual(expectedForeignKeys);

  const migrationJournal = JSON.parse(
    await readFile(resolve(PROJECT_ROOT, "packages/db/migrations/meta/_journal.json"), "utf8"),
  ) as { entries: unknown[] };
  const [migrationCount] = await sql<{ count: number }[]>`
    select count(*)::integer as count from drizzle.__drizzle_migrations
  `;
  expect(migrationCount.count).toBe(migrationJournal.entries.length);

  const publicViews = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm', 'S', 'f')
    order by c.relname
  `;
  expect(publicViews).toEqual([]);
  const publicRoutines = await sql<{ name: string }[]>`
    select p.proname as name
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
    order by p.proname
  `;
  expect(publicRoutines).toEqual([]);

  for (const forbiddenTable of [
    "market_system_state",
    "market_keys",
    "invitation",
    "market_payg_subscription",
    "market_billing_ledger",
    "market_billing_charge_attempt",
    "market_webhook_receipt",
  ]) {
    expect(expectedTableNames).not.toContain(forbiddenTable);
  }
  const forbiddenColumns = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name in (
        'role', 'banned', 'ban_reason', 'ban_expires', 'impersonated_by',
        'custom_usage_limit', 'settlement_cursor', 'fractional_residual'
      )
    order by table_name, column_name
  `;
  expect(forbiddenColumns).toEqual([]);

  const identityForeignKeys = new Map(
    actualForeignKeys.map((foreignKey) => [foreignKey.constraint_name, foreignKey]),
  );
  expect(identityForeignKeys.get("market_usage_owner_user_id_user_id_fk")?.on_delete).toBe(
    "set null",
  );
  expect(identityForeignKeys.get("user_stats_user_id_user_id_fk")?.on_delete).toBe("set null");
  expect(
    identityForeignKeys.get("user_stats_usage_owner_id_market_usage_owner_id_fk")?.on_delete,
  ).toBe("restrict");
  expect(identityForeignKeys.get("market_api_keys_user_id_user_id_fk")?.on_delete).toBe(
    "set null",
  );
  expect(
    identityForeignKeys.get("market_api_usage_events_usage_owner_id_market_usage_owner_id_fk")
      ?.on_delete,
  ).toBe("restrict");
}

async function assertRealSignupCreatesCanonicalCustomer(
  targetSql: DirectSql,
  databaseName: string,
): Promise<DirectSql> {
  vi.resetModules();
  const databaseRuntime = await import("../../lib/db/runtime");
  const database = databaseRuntime.requireDatabase();
  const applicationClient = database.$client;
  const [currentDatabase] = await applicationClient<{ database_name: string }[]>`
    select current_database() as database_name
  `;
  expect(currentDatabase.database_name).toBe(databaseName);

  const authRoute = await import("../../app/api/auth/[...all]/route");
  const email = `fresh-${randomUUID()}@example.com`;
  const signup = await authRoute.POST(
    new Request("http://market.test/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://market.test",
      },
      body: JSON.stringify({
        name: "Fresh Database Customer",
        email,
        password: "Fresh-database-password-123!",
      }),
    }),
  );
  const responseBody = await signup.clone().text();
  expect(signup.status, responseBody).toBe(200);

  const users = await targetSql<{
    id: string;
    name: string;
    email_verified: boolean;
    image: string | null;
  }[]>`
    select id, name, email_verified, image from "user" where email = ${email}
  `;
  expect(users).toHaveLength(1);
  const customer = users[0];
  expect(customer).toMatchObject({
    name: "Fresh Database Customer",
    email_verified: false,
    image: null,
  });

  const accounts = await targetSql<{
    provider_id: string;
    account_id: string;
    password: string | null;
  }[]>`
    select provider_id, account_id, password from account where user_id = ${customer.id}
  `;
  expect(accounts).toHaveLength(1);
  expect(accounts[0].provider_id).toBe("credential");
  expect(accounts[0].account_id).toBe(customer.id);
  expect(accounts[0].password).toEqual(expect.any(String));

  const [cardinality] = await targetSql<{
    sessions: number;
    admins: number;
    owners: number;
    stats: number;
    subscriptions: number;
  }[]>`
    select
      (select count(*)::integer from session where user_id = ${customer.id}) as sessions,
      (select count(*)::integer from system_admin where user_id = ${customer.id}) as admins,
      (select count(*)::integer from market_usage_owner where user_id = ${customer.id}) as owners,
      (select count(*)::integer from user_stats where user_id = ${customer.id}) as stats,
      (
        select count(*)::integer
        from subscription
        where reference_type = 'user' and reference_id = ${customer.id} and plan = 'payg'
      ) as subscriptions
  `;
  expect(cardinality).toEqual({
    sessions: 0,
    admins: 0,
    owners: 1,
    stats: 1,
    subscriptions: 1,
  });

  const [bridge] = await targetSql<{
    owner_id: string;
    stats_owner_id: string;
    stats_reference_id: string;
    subscription_id: string;
    subscription_status: string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }[]>`
    select
      owner.id as owner_id,
      stats.usage_owner_id as stats_owner_id,
      stats.billing_reference_id as stats_reference_id,
      subscription.id as subscription_id,
      subscription.status as subscription_status,
      subscription.stripe_customer_id,
      subscription.stripe_subscription_id
    from market_usage_owner owner
    join user_stats stats on stats.usage_owner_id = owner.id
    join subscription
      on subscription.reference_type = 'user'
      and subscription.reference_id = stats.billing_reference_id
      and subscription.plan = 'payg'
    where owner.user_id = ${customer.id}
  `;
  expect(bridge.stats_owner_id).toBe(bridge.owner_id);
  expect(bridge.stats_reference_id).toBe(customer.id);
  expect(bridge.subscription_id).toBe(`sub_default_${customer.id}`);
  expect(bridge.subscription_status).toBeNull();
  expect(bridge.stripe_customer_id).toBeNull();
  expect(bridge.stripe_subscription_id).toBeNull();
  return applicationClient;
}

describe.sequential("fresh database migration", () => {
  it(
    "applies the checked-in Drizzle chain once and creates a real unverified customer bridge",
    async () => {
      const controlUrl = parseControlUrl(process.env.DATABASE_URL);
      const databaseName = `${GENERATED_DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;
      const targetUrl = generatedDatabaseUrl(controlUrl, databaseName);
      const controlSql = postgres(controlUrl.toString(), { max: 1 });
      let databaseCreated = false;
      let targetSql: DirectSql | null = null;
      let applicationClient: DirectSql | null = null;
      let environmentSnapshot: EnvironmentSnapshot | null = null;

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
          await assertInitiallyEmpty(targetSql);
          await runStandardMigration(targetUrl);
          const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as DrizzleSnapshot;
          await assertCatalogMatchesGeneratedSnapshot(targetSql, snapshot);

          environmentSnapshot = installApplicationEnvironment(targetUrl);
          applicationClient = await assertRealSignupCreatesCanonicalCustomer(targetSql, databaseName);
        } finally {
          try {
            if (applicationClient) await applicationClient.end({ timeout: 5 });
          } finally {
            try {
              if (targetSql) await targetSql.end({ timeout: 5 });
            } finally {
              if (environmentSnapshot) restoreEnvironment(environmentSnapshot);
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
