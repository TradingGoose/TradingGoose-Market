CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" text DEFAULT 'TG_CHAN_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_pkey" PRIMARY KEY("id"),
	CONSTRAINT "chains_id_pattern" CHECK ("chains"."id" ~ '^TG_CHAN_[0-9A-F]{6}$'),
	CONSTRAINT "chains_code_pattern" CHECK ("chains"."code" ~ '^[A-Z0-9]{1,16}$')
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" text DEFAULT 'TG_CITY_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"country_id" text NOT NULL,
	"name" text NOT NULL,
	"time_zone_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_pkey" PRIMARY KEY("id"),
	CONSTRAINT "cities_id_pattern" CHECK ("cities"."id" ~ '^TG_CITY_[0-9A-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" text DEFAULT 'TG_CTRY_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_pkey" PRIMARY KEY("id"),
	CONSTRAINT "countries_id_pattern" CHECK ("countries"."id" ~ '^TG_CTRY_[0-9A-F]{6}$'),
	CONSTRAINT "countries_code_pattern" CHECK ("countries"."code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "cryptos" (
	"id" text DEFAULT 'TG_CRYP_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"asset_type" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"contract_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"icon_url" text,
	"logo_missing" boolean DEFAULT true NOT NULL,
	"logo_checked_at" timestamp with time zone,
	"rank" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cryptos_pkey" PRIMARY KEY("id"),
	CONSTRAINT "cryptos_id_pattern" CHECK ("cryptos"."id" ~ '^TG_CRYP_[0-9A-F]{6}$'),
	CONSTRAINT "cryptos_code_pattern" CHECK ("cryptos"."code" ~ '^.{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" text DEFAULT 'TG_CURR_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currencies_pkey" PRIMARY KEY("id"),
	CONSTRAINT "currencies_code_pattern" CHECK ("currencies"."code" ~ '^[A-Z0-9]{1,16}$')
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"id" text DEFAULT 'TG_EXCH_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"mic" text NOT NULL,
	"name" text,
	"lei" text,
	"url" text,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"is_segment" boolean DEFAULT false NOT NULL,
	"country_id" text,
	"city_id" text,
	"market_id" text,
	"parent_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchanges_pkey" PRIMARY KEY("id"),
	CONSTRAINT "exchanges_id_pattern" CHECK ("exchanges"."id" ~ '^TG_EXCH_[0-9A-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" text DEFAULT 'TG_LSTG_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"base" text NOT NULL,
	"quote" text,
	"name" text,
	"icon_url" text,
	"market_id" text,
	"logo_missing" boolean DEFAULT true NOT NULL,
	"logo_checked_at" timestamp with time zone,
	"primary_exch_id" text,
	"secondary_exch_ids" text[],
	"asset_class" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_pkey" PRIMARY KEY("id"),
	CONSTRAINT "listings_id_pattern" CHECK ("listings"."id" ~ '^TG_LSTG_[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "market_hours" (
	"id" text DEFAULT 'TG_MH_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"exch_id" text,
	"asset_class" text,
	"country_id" text,
	"market_id" text,
	"listing_id" text,
	"time_zone_id" text NOT NULL,
	"hours" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_hours_pkey" PRIMARY KEY("id"),
	CONSTRAINT "market_hours_id_pattern" CHECK ("market_hours"."id" ~ '^TG_MH_[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "market_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_suffix" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text DEFAULT 'TG_MKT_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"city_id" text,
	"country_id" text NOT NULL,
	"time_zone_id" text,
	"url" text,
	CONSTRAINT "markets_pkey" PRIMARY KEY("id"),
	CONSTRAINT "markets_code_unique" UNIQUE("code"),
	CONSTRAINT "markets_id_pattern" CHECK ("markets"."id" ~ '^TG_MKT_[0-9A-F]{6}$'),
	CONSTRAINT "markets_code_pattern" CHECK ("markets"."code" ~ '^[A-Z0-9]{1,16}$')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "time_zones" (
	"id" text DEFAULT 'TG_TZ_' || upper(substr(md5(random()::text), 1, 6)) NOT NULL,
	"name" text NOT NULL,
	"offset" text NOT NULL,
	"offset_dst" text,
	"observes_dst" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_zones_pkey" PRIMARY KEY("id"),
	CONSTRAINT "time_zones_id_pattern" CHECK ("time_zones"."id" ~ '^TG_TZ_[0-9A-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"stripe_customer_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_time_zone_id_time_zones_id_fk" FOREIGN KEY ("time_zone_id") REFERENCES "public"."time_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchanges" ADD CONSTRAINT "exchanges_parent_id_exchanges_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."exchanges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_quote_currencies_id_fk" FOREIGN KEY ("quote") REFERENCES "public"."currencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_primary_exch_id_exchanges_id_fk" FOREIGN KEY ("primary_exch_id") REFERENCES "public"."exchanges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_hours" ADD CONSTRAINT "market_hours_exch_id_exchanges_id_fk" FOREIGN KEY ("exch_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_hours" ADD CONSTRAINT "market_hours_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_hours" ADD CONSTRAINT "market_hours_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_hours" ADD CONSTRAINT "market_hours_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_hours" ADD CONSTRAINT "market_hours_time_zone_id_time_zones_id_fk" FOREIGN KEY ("time_zone_id") REFERENCES "public"."time_zones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_time_zone_id_time_zones_id_fk" FOREIGN KEY ("time_zone_id") REFERENCES "public"."time_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chains_code_name_idx" ON "chains" USING btree ("code","name");--> statement-breakpoint
CREATE UNIQUE INDEX "cities_country_code_name_idx" ON "cities" USING btree ("country_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_code_idx" ON "countries" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "countries_name_idx" ON "countries" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "cryptos_code_name_idx" ON "cryptos" USING btree ("code","name");--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_code_idx" ON "currencies" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "currencies_name_idx" ON "currencies" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "exchanges_exch_idx" ON "exchanges" USING btree ("mic");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_base_quote_primary_exch_idx" ON "listings" USING btree ("base","quote","primary_exch_id","asset_class","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_hours_unique_idx" ON "market_hours" USING btree ("exch_id","country_id","asset_class","listing_id");--> statement-breakpoint
CREATE INDEX "market_keys_key_suffix_idx" ON "market_keys" USING btree ("key_suffix");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_code_idx" ON "markets" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_name_idx" ON "markets" USING btree ("name");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "time_zones_name_idx" ON "time_zones" USING btree ("name");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");