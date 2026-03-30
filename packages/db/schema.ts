import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  index,
  pgTable,
  primaryKey,
  foreignKey,
  text,
  timestamp,
  uniqueIndex,
  date,
  check
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
    role: text("role").default("viewer"),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true }),
    stripeCustomerId: text("stripe_customer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  }
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
    impersonatedBy: text("impersonated_by"),
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

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    role: text("role").notNull().default("viewer"),
    token: text("token").notNull().unique(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`)
  },
  (table) => ({
    tokenIdx: uniqueIndex("invitation_token_idx").on(table.token),
    emailIdx: index("invitation_email_idx").on(table.email),
    statusIdx: index("invitation_status_idx").on(table.status)
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
    uniqueCodeNameIdx: uniqueIndex("cryptos_code_name_idx").on(table.code, table.name)
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
    uniqueNameIdx: uniqueIndex("markets_name_idx").on(table.name)
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
    parentIdFk: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id]
    }).onDelete("set null")
  })
);

export const marketKeys = pgTable(
  "market_keys",
  {
    id: text("id").primaryKey(),
    publicId: text("public_id").notNull(),
    userId: text("user_id").notNull(),
    secretHash: text("secret_hash").notNull(),
    suffix: text("suffix"),
    name: text("name"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "string" }),
    revokedAt: timestamp("revoked_at", { mode: "string" }),
    expiresAt: timestamp("expires_at", { mode: "string" })
  },
  (table) => ({
    publicIdUidx: uniqueIndex("market_keys_public_id_uidx").on(table.publicId),
    userIdIdx: index("market_keys_user_id_idx").on(table.userId),
    statusIdx: index("market_keys_status_idx").on(table.status)
  })
);

export const marketBillingOutbox = pgTable(
  "market_billing_outbox",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    userId: text("user_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { mode: "string" }),
    nextRetryAt: timestamp("next_retry_at", { mode: "string" }),
    deliveredAt: timestamp("delivered_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).notNull().default(sql`now()`)
  },
  (table) => ({
    pendingIdx: index("market_billing_outbox_pending_idx").on(table.deliveredAt, table.nextRetryAt),
    userIdIdx: index("market_billing_outbox_user_id_idx").on(table.userId)
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
    )
  })
);
