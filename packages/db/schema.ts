import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

// Trading hours payload type (single authoritative zone: timeZone)
export type TradingHours = {
  sessions: {
    sunday: unknown[];
    monday: unknown[];
    tuesday: unknown[];
    wednesday: unknown[];
    thursday: unknown[];
    friday: unknown[];
    saturday: unknown[];
  };
  holidays: string[];
  earlyCloses: Record<string, string>;
};

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull(),
    image: text("image"),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    stripeCustomerIdUnique: uniqueIndex("user_stripe_customer_id_unique").on(
      table.stripeCustomerId
    )
  })
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
  },
  (table) => ({
    userIdIdx: index("session_user_id_idx").on(table.userId),
    tokenIdx: index("session_token_idx").on(table.token)
  })
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    userIdIdx: index("account_user_id_idx").on(table.userId)
  })
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
  },
  (table) => ({
    identifierIdx: index("verification_identifier_idx").on(table.identifier)
  })
);

export const systemAdmin = pgTable(
  "system_admin",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    userIdUnique: uniqueIndex("system_admin_user_id_unique").on(table.userId),
    statusIdx: index("system_admin_status_idx").on(table.status),
    statusCheck: check(
      "system_admin_status_check",
      sql`${table.status} in ('active', 'removing')`
    )
  })
);

export const marketUsageOwner = pgTable(
  "market_usage_owner",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    userIdUnique: uniqueIndex("market_usage_owner_user_id_unique").on(table.userId)
  })
);

export type MarketSubscriptionMetadata = Record<string, unknown> & {
  paygActivationAttemptId?: string;
};

export const subscription = pgTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    plan: text("plan").notNull(),
    referenceType: text("reference_type").notNull().default("user"),
    referenceId: text("reference_id").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end"),
    seats: integer("seats"),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    metadata: jsonb("metadata").$type<MarketSubscriptionMetadata | null>()
  },
  (table) => ({
    referenceStatusIdx: index("subscription_reference_status_idx").on(
      table.referenceType,
      table.referenceId,
      table.status
    ),
    referencePlanUnique: uniqueIndex("subscription_reference_plan_unique").on(
      table.referenceType,
      table.referenceId,
      table.plan
    ),
    stripeSubscriptionIdUnique: uniqueIndex(
      "subscription_stripe_subscription_id_unique"
    ).on(table.stripeSubscriptionId),
    planCheck: check("subscription_plan_check", sql`${table.plan} = 'payg'`),
    referenceTypeCheck: check(
      "subscription_reference_type_check",
      sql`${table.referenceType} in ('user', 'organization')`
    ),
    defaultUserIdCheck: check(
      "subscription_default_user_id_check",
      sql`${table.referenceType} <> 'user' or ${table.id} = 'sub_default_' || ${table.referenceId}`
    ),
    periodCheck: check(
      "subscription_period_check",
      sql`${table.periodStart} is null or ${table.periodEnd} is null or ${table.periodEnd} >= ${table.periodStart}`
    ),
    seatsCheck: check(
      "subscription_seats_check",
      sql`${table.seats} is null or ${table.seats} > 0`
    )
  })
);

export const userStats = pgTable(
  "user_stats",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    usageOwnerId: text("usage_owner_id")
      .notNull()
      .references(() => marketUsageOwner.id, { onDelete: "restrict" }),
    billingReferenceId: text("billing_reference_id").notNull(),
    totalRequestQuantity: numeric("total_request_quantity").notNull().default("0"),
    currentPeriodRequestQuantity: numeric("current_period_request_quantity")
      .notNull()
      .default("0"),
    lastPeriodRequestQuantity: numeric("last_period_request_quantity").notNull().default("0"),
    totalCost: numeric("total_cost").notNull().default("0"),
    currentPeriodCost: numeric("current_period_cost").notNull().default("0"),
    lastPeriodCost: numeric("last_period_cost").notNull().default("0"),
    billedOverageThisPeriod: numeric("billed_overage_this_period").notNull().default("0"),
    lastActive: timestamp("last_active", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    userIdUnique: uniqueIndex("user_stats_user_id_unique").on(table.userId),
    usageOwnerIdUnique: uniqueIndex("user_stats_usage_owner_id_unique").on(
      table.usageOwnerId
    ),
    billingReferenceIdUnique: uniqueIndex(
      "user_stats_billing_reference_id_unique"
    ).on(table.billingReferenceId),
    quantitiesCheck: check(
      "user_stats_quantities_check",
      sql`
        ${table.totalRequestQuantity} >= 0
        and scale(${table.totalRequestQuantity}) = 0
        and ${table.currentPeriodRequestQuantity} >= 0
        and scale(${table.currentPeriodRequestQuantity}) = 0
        and ${table.lastPeriodRequestQuantity} >= 0
        and scale(${table.lastPeriodRequestQuantity}) = 0
      `
    ),
    costsCheck: check(
      "user_stats_costs_check",
      sql`
        ${table.totalCost} >= 0
        and ${table.currentPeriodCost} >= 0
        and ${table.lastPeriodCost} >= 0
        and ${table.billedOverageThisPeriod} >= 0
        and ${table.billedOverageThisPeriod} <= ${table.currentPeriodCost}
      `
    )
  })
);

export const marketApiKeys = pgTable(
  "market_api_keys",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    usageOwnerId: text("usage_owner_id")
      .notNull()
      .references(() => marketUsageOwner.id, { onDelete: "restrict" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    unkeyKeyId: text("unkey_key_id").notNull(),
    adminGrantId: text("admin_grant_id"),
    keyClass: text("key_class").notNull(),
    name: text("name").notNull(),
    displayValue: text("display_value").notNull(),
    spendLimitUsd: numeric("spend_limit_usd"),
    spendWindowDays: integer("spend_window_days"),
    spendLimitRevision: integer("spend_limit_revision"),
    spendLimitUpdatedAt: timestamp("spend_limit_updated_at", { withTimezone: true }),
    providerObservedRevision: integer("provider_observed_revision"),
    providerQuantumNanoUsd: numeric("provider_quantum_nano_usd"),
    providerLimitUnits: numeric("provider_limit_units"),
    providerRemainingUnits: numeric("provider_remaining_units"),
    providerDurationMs: numeric("provider_duration_ms"),
    providerResetAt: timestamp("provider_reset_at", { withTimezone: true }),
    providerDecision: text("provider_decision"),
    providerObservedAt: timestamp("provider_observed_at", { withTimezone: true }),
    revocationRequestedAt: timestamp("revocation_requested_at", { withTimezone: true }),
    providerRevokedAt: timestamp("provider_revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    unkeyKeyIdUnique: uniqueIndex("market_api_keys_unkey_key_id_unique").on(table.unkeyKeyId),
    ownerCreatedIdx: index("market_api_keys_owner_created_idx").on(
      table.usageOwnerId,
      table.createdAt
    ),
    userIdIdx: index("market_api_keys_user_id_idx").on(table.userId),
    adminGrantIdIdx: index("market_api_keys_admin_grant_id_idx").on(table.adminGrantId),
    keyClassCheck: check(
      "market_api_keys_key_class_check",
      sql`${table.keyClass} in ('public', 'private')`
    ),
    classOwnerCheck: check(
      "market_api_keys_class_owner_check",
      sql`(${table.keyClass} = 'public' and ${table.adminGrantId} is null) or (${table.keyClass} = 'private' and ${table.adminGrantId} is not null)`
    ),
    spendLimitCheck: check(
      "market_api_keys_spend_limit_check",
      sql`
        (
          ${table.keyClass} = 'public'
          and (
            (${table.spendLimitUsd} is null and ${table.spendWindowDays} is null)
            or (
              ${table.spendLimitUsd} is not null
              and ${table.spendWindowDays} is not null
              and ${table.spendLimitUsd} > 0
              and scale(${table.spendLimitUsd}) = 0
              and ${table.spendWindowDays} between 1 and 30
            )
          )
        )
        or (
          ${table.keyClass} = 'private'
          and ${table.spendLimitUsd} is null
          and ${table.spendWindowDays} is null
        )
      `
    ),
    revisionCheck: check(
      "market_api_keys_revision_check",
      sql`
        (
          ${table.keyClass} = 'public'
          and ${table.spendLimitRevision} is not null
          and ${table.spendLimitRevision} > 0
          and ${table.spendLimitUpdatedAt} is not null
        )
        or (${table.keyClass} = 'private' and ${table.spendLimitRevision} is null and ${table.spendLimitUpdatedAt} is null)
      `
    ),
    providerObservationCheck: check(
      "market_api_keys_provider_observation_check",
      sql`
        (
          ${table.providerObservedRevision} is null
          and ${table.providerQuantumNanoUsd} is null
          and ${table.providerLimitUnits} is null
          and ${table.providerRemainingUnits} is null
          and ${table.providerDurationMs} is null
          and ${table.providerResetAt} is null
          and ${table.providerDecision} is null
          and ${table.providerObservedAt} is null
        )
        or (
          ${table.keyClass} = 'public'
          and ${table.providerObservedRevision} is not null
          and ${table.providerObservedRevision} between 1 and ${table.spendLimitRevision}
          and ${table.providerQuantumNanoUsd} is not null
          and ${table.providerQuantumNanoUsd} > 0
          and scale(${table.providerQuantumNanoUsd}) = 0
          and ${table.providerLimitUnits} is not null
          and ${table.providerLimitUnits} between 1 and 9007199254740991
          and scale(${table.providerLimitUnits}) = 0
          and ${table.providerRemainingUnits} is not null
          and ${table.providerRemainingUnits} between 0 and ${table.providerLimitUnits}
          and scale(${table.providerRemainingUnits}) = 0
          and ${table.providerDurationMs} is not null
          and ${table.providerDurationMs} between 1 and 9007199254740991
          and scale(${table.providerDurationMs}) = 0
          and ${table.providerResetAt} is not null
          and ${table.providerDecision} is not null
          and ${table.providerDecision} in ('allowed', 'rate_limited')
          and ${table.providerObservedAt} is not null
        )
      `
    ),
    revocationCheck: check(
      "market_api_keys_revocation_check",
      sql`${table.providerRevokedAt} is null or ${table.revocationRequestedAt} is not null`
    )
  })
);

export const marketApiKeyCreationAttempts = pgTable(
  "market_api_key_creation_attempts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    reservedKeyId: text("reserved_key_id").notNull(),
    usageOwnerId: text("usage_owner_id")
      .notNull()
      .references(() => marketUsageOwner.id, { onDelete: "restrict" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    adminGrantId: text("admin_grant_id"),
    keyClass: text("key_class").notNull(),
    name: text("name").notNull(),
    spendLimitUsd: numeric("spend_limit_usd"),
    spendWindowDays: integer("spend_window_days"),
    correlationId: text("correlation_id").notNull(),
    state: text("state").notNull().default("reserved"),
    providerKeyId: text("provider_key_id"),
    providerDisplayValue: text("provider_display_value"),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    reservedKeyIdUnique: uniqueIndex("market_api_key_attempts_reserved_key_id_unique").on(
      table.reservedKeyId
    ),
    correlationIdUnique: uniqueIndex("market_api_key_attempts_correlation_id_unique").on(
      table.correlationId
    ),
    providerKeyIdUnique: uniqueIndex("market_api_key_attempts_provider_key_id_unique").on(
      table.providerKeyId
    ),
    ownerCreatedIdx: index("market_api_key_attempts_owner_created_idx").on(
      table.usageOwnerId,
      table.createdAt
    ),
    stateCheck: check(
      "market_api_key_attempts_state_check",
      sql`${table.state} in ('reserved', 'dispatched', 'cleanup_required')`
    ),
    keyClassCheck: check(
      "market_api_key_attempts_key_class_check",
      sql`${table.keyClass} in ('public', 'private')`
    ),
    dispatchCheck: check(
      "market_api_key_attempts_dispatch_check",
      sql`
        (
          ${table.state} = 'reserved'
          and ${table.dispatchedAt} is null
          and ${table.providerKeyId} is null
          and ${table.providerDisplayValue} is null
        )
        or (${table.state} <> 'reserved' and ${table.dispatchedAt} is not null)
      `
    ),
    providerProjectionCheck: check(
      "market_api_key_attempts_provider_projection_check",
      sql`
        (${table.providerKeyId} is null and ${table.providerDisplayValue} is null)
        or (${table.providerKeyId} is not null and ${table.providerDisplayValue} is not null)
      `
    ),
    classOwnerCheck: check(
      "market_api_key_attempts_class_owner_check",
      sql`(${table.keyClass} = 'public' and ${table.adminGrantId} is null) or (${table.keyClass} = 'private' and ${table.adminGrantId} is not null)`
    ),
    spendLimitCheck: check(
      "market_api_key_attempts_spend_limit_check",
      sql`
        (
          ${table.keyClass} = 'public'
          and (
            (${table.spendLimitUsd} is null and ${table.spendWindowDays} is null)
            or (
              ${table.spendLimitUsd} is not null
              and ${table.spendWindowDays} is not null
              and ${table.spendLimitUsd} > 0
              and scale(${table.spendLimitUsd}) = 0
              and ${table.spendWindowDays} between 1 and 30
            )
          )
        )
        or (
          ${table.keyClass} = 'private'
          and ${table.spendLimitUsd} is null
          and ${table.spendWindowDays} is null
        )
      `
    )
  })
);

export const marketApiUsageEvent = pgTable(
  "market_api_usage_events",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    usageOwnerId: text("usage_owner_id")
      .notNull()
      .references(() => marketUsageOwner.id, { onDelete: "restrict" }),
    marketApiKeyId: text("market_api_key_id")
      .notNull()
      .references(() => marketApiKeys.id, { onDelete: "restrict" }),
    keyClass: text("key_class").notNull(),
    routeId: text("route_id").notNull(),
    category: text("category").notNull(),
    resourceId: text("resource_id").notNull(),
    method: text("method").notNull(),
    apiVersion: text("api_version").notNull(),
    admittedAt: timestamp("admitted_at", { withTimezone: true }).notNull().defaultNow(),
    billingMode: text("billing_mode").notNull(),
    billableQuantity: integer("billable_quantity").notNull(),
    rateUsdPer1000Reads: numeric("rate_usd_per_1000_reads"),
    billableCostUsd: numeric("billable_cost_usd"),
    applicationUrl: text("application_url"),
    applicationTitle: text("application_title")
  },
  (table) => ({
    ownerAdmittedIdx: index("market_api_usage_events_owner_admitted_idx").on(
      table.usageOwnerId,
      table.admittedAt,
      table.id
    ),
    keyAdmittedIdx: index("market_api_usage_events_key_admitted_idx").on(
      table.marketApiKeyId,
      table.admittedAt,
      table.id
    ),
    categoryAdmittedIdx: index("market_api_usage_events_category_admitted_idx").on(
      table.category,
      table.admittedAt
    ),
    keyClassCheck: check(
      "market_api_usage_events_key_class_check",
      sql`${table.keyClass} in ('public', 'private')`
    ),
    resourceCheck: check(
      "market_api_usage_events_resource_check",
      sql`${table.resourceId} in ('market_instrument', 'city', 'country', 'currency', 'crypto', 'exchange', 'listing_identity', 'market_hour', 'timezone')`
    ),
    methodCheck: check(
      "market_api_usage_events_method_check",
      sql`(${table.keyClass} = 'public' and ${table.method} in ('GET', 'HEAD')) or (${table.keyClass} = 'private' and ${table.method} = 'POST')`
    ),
    versionCheck: check(
      "market_api_usage_events_version_check",
      sql`${table.apiVersion} = 'v1'`
    ),
    normalizedLabelsCheck: check(
      "market_api_usage_events_normalized_labels_check",
      sql`length(btrim(${table.routeId})) > 0 and length(btrim(${table.category})) > 0`
    ),
    billingModeCheck: check(
      "market_api_usage_events_billing_mode_check",
      sql`${table.billingMode} in ('enabled', 'disabled')`
    ),
    billableCheck: check(
      "market_api_usage_events_billable_check",
      sql`
        (
          ${table.billableQuantity} = 1
          and ${table.keyClass} = 'public'
          and ${table.billingMode} = 'enabled'
          and ${table.rateUsdPer1000Reads} is not null
          and ${table.rateUsdPer1000Reads} > 0
          and ${table.billableCostUsd} is not null
          and ${table.billableCostUsd} > 0
          and ${table.billableCostUsd} * 1000 = ${table.rateUsdPer1000Reads}
        )
        or (
          ${table.billableQuantity} = 0
          and ${table.rateUsdPer1000Reads} is null
          and ${table.billableCostUsd} is null
        )
      `
    ),
    attributionCheck: check(
      "market_api_usage_events_attribution_check",
      sql`${table.applicationTitle} is null or ${table.applicationUrl} is not null`
    )
  })
);

export const marketApiUsageCompletion = pgTable(
  "market_api_usage_completions",
  {
    eventId: text("event_id")
      .primaryKey()
      .references(() => marketApiUsageEvent.id, { onDelete: "cascade" }),
    resultClass: text("result_class").notNull(),
    httpStatus: integer("http_status").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    resultStatusCheck: check(
      "market_api_usage_completions_result_status_check",
      sql`
        (${table.resultClass} = 'success' and ${table.httpStatus} between 200 and 399)
        or (${table.resultClass} = 'client_error' and ${table.httpStatus} between 400 and 499)
        or (${table.resultClass} = 'server_error' and ${table.httpStatus} between 500 and 599)
      `
    )
  })
);

export const timeZones = pgTable(
  "time_zones",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_TZ_' || upper(substr(md5(random()::text), 1, 6))`),
    name: text("name").notNull(),
    offset: text("offset").notNull(),
    offsetDst: text("offset_dst"),
    observesDst: boolean("observes_dst").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "time_zones_pkey" }),
    idPattern: check("time_zones_id_pattern", sql`${table.id} ~ '^TG_TZ_[0-9A-F]{6}$'`),
    uniqueNameIdx: uniqueIndex("time_zones_name_idx").on(table.name)
  })
);

export const countries = pgTable(
  "countries",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_CTRY_' || upper(substr(md5(random()::text), 1, 6))`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    rank: integer("rank").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "countries_pkey" }),
    idPattern: check("countries_id_pattern", sql`${table.id} ~ '^TG_CTRY_[0-9A-F]{6}$'`),
    codePattern: check("countries_code_pattern", sql`${table.code} ~ '^[A-Z]{2}$'`),
    uniqueCodeIdx: uniqueIndex("countries_code_idx").on(table.code),
    uniqueNameIdx: uniqueIndex("countries_name_idx").on(table.name)
  })
);

export const currencies = pgTable(
  "currencies",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_CURR_' || upper(substr(md5(random()::text), 1, 6))`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    rank: integer("rank").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "currencies_pkey" }),
    // Allow alphanumeric currency codes up to 16 chars
    codePattern: check("currencies_code_pattern", sql`${table.code} ~ '^[A-Z0-9]{1,16}$'`),
    uniqueCodeIdx: uniqueIndex("currencies_code_idx").on(table.code),
    uniqueNameIdx: uniqueIndex("currencies_name_idx").on(table.name)
  })
);

export const chains = pgTable(
  "chains",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_CHAN_' || upper(substr(md5(random()::text), 1, 6))`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    iconUrl: text("icon_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "chains_pkey" }),
    idPattern: check("chains_id_pattern", sql`${table.id} ~ '^TG_CHAN_[0-9A-F]{6}$'`),
    codePattern: check("chains_code_pattern", sql`${table.code} ~ '^[A-Z0-9]{1,16}$'`),
    uniqueCodeNameIdx: uniqueIndex("chains_code_name_idx").on(table.code, table.name)
  })
);

export const cryptos = pgTable(
  "cryptos",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_CRYP_' || upper(substr(md5(random()::text), 1, 6))`),
    code: text("code").notNull(),
    name: text("name").notNull(),
    assetType: text("asset_type").notNull().default(""),
    active: boolean("active").notNull().default(true),
    contractAddresses: jsonb("contract_addresses")
      .$type<Array<{ chainId: string; address: string; contractType: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    iconUrl: text("icon_url"),
    logoMissing: boolean("logo_missing").notNull().default(true),
    logoCheckedAt: timestamp("logo_checked_at", { withTimezone: true }),
    rank: integer("rank").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "cryptos_pkey" }),
    idPattern: check("cryptos_id_pattern", sql`${table.id} ~ '^TG_CRYP_[0-9A-F]{6}$'`),
    codePattern: check("cryptos_code_pattern", sql`${table.code} ~ '^.{1,64}$'`),
    uniqueCodeNameIdx: uniqueIndex("cryptos_code_name_idx").on(table.code, table.name),
    rankCodeIdx: index("cryptos_rank_code_idx").on(sql`rank DESC, code ASC`),
    assetTypeIdx: index("cryptos_asset_type_idx").on(table.assetType)
  })
);

export const cities = pgTable(
  "cities",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_CITY_' || upper(substr(md5(random()::text), 1, 6))`),
    countryId: text("country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timeZoneId: text("time_zone_id").notNull()
      .references(() => timeZones.id, { onDelete: "restrict" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "cities_pkey" }),
    idPattern: check("cities_id_pattern", sql`${table.id} ~ '^TG_CITY_[0-9A-F]{6}$'`),
    uniqueCountryCityIdx: uniqueIndex("cities_country_code_name_idx").on(table.countryId, table.name)
  })
);

export const markets = pgTable(
  "markets",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_MKT_' || upper(substr(md5(random()::text), 1, 6))`),
    name: text("name").notNull(),
    code: text("code").notNull().unique(),
    cityId: text("city_id").references(() => cities.id, { onDelete: "set null" }),
    countryId: text("country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "set null" }),
    timeZoneId: text("time_zone_id")
      .references(() => timeZones.id, { onDelete: "restrict" }),
    url: text("url")
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "markets_pkey" }),
    idPattern: check("markets_id_pattern", sql`${table.id} ~ '^TG_MKT_[0-9A-F]{6}$'`),
    codePattern: check("markets_code_pattern", sql`${table.code} ~ '^[A-Z0-9]{1,16}$'`),
    uniqueCodeIdx: uniqueIndex("markets_code_idx").on(table.code),
    uniqueNameIdx: uniqueIndex("markets_name_idx").on(table.name),
    countryIdIdx: index("markets_country_id_idx").on(table.countryId)
  })
);

export const exchanges = pgTable(
  "exchanges",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_EXCH_' || upper(substr(md5(random()::text), 1, 6))`),
    mic: text("mic").notNull(),
    name: text("name"),
    lei: text("lei"),
    url: text("url"),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    isSegment: boolean("is_segment").notNull().default(false),
    countryId: text("country_id").references(() => countries.id, { onDelete: "set null" }),
    cityId: text("city_id").references(() => cities.id, { onDelete: "set null" }),
    marketId: text("market_id").references(() => markets.id, { onDelete: "set null" }),
    parentId: text("parent_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "exchanges_pkey" }),
    idPattern: check("exchanges_id_pattern", sql`${table.id} ~ '^TG_EXCH_[0-9A-F]{6}$'`),
    micIdx: uniqueIndex("exchanges_exch_idx").on(table.mic),
    countryIdIdx: index("exchanges_country_id_idx").on(table.countryId),
    marketIdIdx: index("exchanges_market_id_idx").on(table.marketId),
    parentIdFk: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id]
    }).onDelete("set null")
  })
);

export const marketHours = pgTable(
  "market_hours",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_MH_' || upper(substr(md5(random()::text), 1, 6))`),
    exchId: text("exch_id")
      .references(() => exchanges.id, { onDelete: "cascade" }),
    assetClass: text("asset_class"),
    countryId: text("country_id")
      .references(() => countries.id, { onDelete: "set null" }),
    marketId: text("market_id")
      .references(() => markets.id, { onDelete: "set null" }),
    listingId: text("listing_id")
      .references(() => listings.id, { onDelete: "cascade" }),
    timeZoneId: text("time_zone_id").notNull()
      .references(() => timeZones.id, { onDelete: "cascade" }),
    hours: jsonb("hours").$type<TradingHours | null>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "market_hours_pkey" }),
    idPattern: check("market_hours_id_pattern", sql`${table.id} ~ '^TG_MH_[0-9A-Fa-f]{6}$'`),
    uniqueLocSegAssetIdx: uniqueIndex("market_hours_unique_idx").on(
      table.exchId,
      table.countryId,
      table.assetClass,
      table.listingId
    )
  })
);

// Listings table: one row per venue-specific line (base/quote for non-crypto/currency asset classes)
export const listings = pgTable(
  "listings",
  {
    id: text("id")
      .notNull()
      .default(sql`'TG_LSTG_' || upper(substr(md5(random()::text), 1, 6))`),
    base: text("base").notNull(), // ticker/root/base leg (e.g., AAPL, GBP, BTC)
    quote: text("quote").references(() => currencies.id, { onDelete: "set null" }), // reference to currencies.id (quote currency/trading currency)
    name: text("name"), // optional display name override
    iconUrl: text("icon_url"),
    marketId: text("market_id").references(() => markets.id, { onDelete: "set null" }),
    logoMissing: boolean("logo_missing").notNull().default(true),
    logoCheckedAt: timestamp("logo_checked_at", { withTimezone: true }),
    primaryExchId: text("primary_exch_id").references(() => exchanges.id, { onDelete: "set null" }),
    secondaryExchIds: text("secondary_exch_ids").array(),
    assetClass: text("asset_class").notNull(),
    active: boolean("active").notNull().default(true),
    rank: integer("rank").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id], name: "listings_pkey" }),
    idPattern: check("listings_id_pattern", sql`${table.id} ~ '^TG_LSTG_[0-9A-Fa-f]{6}$'`),
    listingUniqueIdx: uniqueIndex("listings_base_quote_primary_exch_idx").on(
      table.base,
      table.quote,
      table.primaryExchId,
      table.assetClass,
      table.marketId
    ),
    quoteIdx: index("listings_quote_idx").on(table.quote),
    marketIdIdx: index("listings_market_id_idx").on(table.marketId),
    primaryExchIdIdx: index("listings_primary_exch_id_idx").on(table.primaryExchId),
    assetClassIdx: index("listings_asset_class_idx").on(table.assetClass),
    rankBaseIdx: index("listings_rank_base_idx").on(sql`rank DESC, base ASC`)
  })
);
