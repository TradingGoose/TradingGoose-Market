CREATE TABLE "market_api_key_creation_attempts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reserved_key_id" text NOT NULL,
	"usage_owner_id" text NOT NULL,
	"user_id" text,
	"admin_grant_id" text,
	"key_class" text NOT NULL,
	"name" text NOT NULL,
	"spend_limit_usd" numeric,
	"spend_window_days" integer,
	"correlation_id" text NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"provider_key_id" text,
	"provider_display_value" text,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_api_key_attempts_state_check" CHECK ("market_api_key_creation_attempts"."state" in ('reserved', 'dispatched', 'cleanup_required')),
	CONSTRAINT "market_api_key_attempts_key_class_check" CHECK ("market_api_key_creation_attempts"."key_class" in ('public', 'private')),
	CONSTRAINT "market_api_key_attempts_dispatch_check" CHECK (
        (
          "market_api_key_creation_attempts"."state" = 'reserved'
          and "market_api_key_creation_attempts"."dispatched_at" is null
          and "market_api_key_creation_attempts"."provider_key_id" is null
          and "market_api_key_creation_attempts"."provider_display_value" is null
        )
        or ("market_api_key_creation_attempts"."state" <> 'reserved' and "market_api_key_creation_attempts"."dispatched_at" is not null)
      ),
	CONSTRAINT "market_api_key_attempts_provider_projection_check" CHECK (
        ("market_api_key_creation_attempts"."provider_key_id" is null and "market_api_key_creation_attempts"."provider_display_value" is null)
        or ("market_api_key_creation_attempts"."provider_key_id" is not null and "market_api_key_creation_attempts"."provider_display_value" is not null)
      ),
	CONSTRAINT "market_api_key_attempts_class_owner_check" CHECK (("market_api_key_creation_attempts"."key_class" = 'public' and "market_api_key_creation_attempts"."admin_grant_id" is null) or ("market_api_key_creation_attempts"."key_class" = 'private' and "market_api_key_creation_attempts"."admin_grant_id" is not null)),
	CONSTRAINT "market_api_key_attempts_spend_limit_check" CHECK (
        (
          "market_api_key_creation_attempts"."key_class" = 'public'
          and (
            ("market_api_key_creation_attempts"."spend_limit_usd" is null and "market_api_key_creation_attempts"."spend_window_days" is null)
            or (
              "market_api_key_creation_attempts"."spend_limit_usd" is not null
              and "market_api_key_creation_attempts"."spend_window_days" is not null
              and "market_api_key_creation_attempts"."spend_limit_usd" > 0
              and scale("market_api_key_creation_attempts"."spend_limit_usd") = 0
              and "market_api_key_creation_attempts"."spend_window_days" between 1 and 30
            )
          )
        )
        or (
          "market_api_key_creation_attempts"."key_class" = 'private'
          and "market_api_key_creation_attempts"."spend_limit_usd" is null
          and "market_api_key_creation_attempts"."spend_window_days" is null
        )
      )
);
--> statement-breakpoint
CREATE TABLE "market_api_keys" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_owner_id" text NOT NULL,
	"user_id" text,
	"unkey_key_id" text NOT NULL,
	"admin_grant_id" text,
	"key_class" text NOT NULL,
	"name" text NOT NULL,
	"display_value" text NOT NULL,
	"spend_limit_usd" numeric,
	"spend_window_days" integer,
	"spend_limit_revision" integer,
	"spend_limit_updated_at" timestamp with time zone,
	"provider_observed_revision" integer,
	"provider_quantum_nano_usd" numeric,
	"provider_limit_units" numeric,
	"provider_remaining_units" numeric,
	"provider_duration_ms" numeric,
	"provider_reset_at" timestamp with time zone,
	"provider_decision" text,
	"provider_observed_at" timestamp with time zone,
	"revocation_requested_at" timestamp with time zone,
	"provider_revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_api_keys_key_class_check" CHECK ("market_api_keys"."key_class" in ('public', 'private')),
	CONSTRAINT "market_api_keys_class_owner_check" CHECK (("market_api_keys"."key_class" = 'public' and "market_api_keys"."admin_grant_id" is null) or ("market_api_keys"."key_class" = 'private' and "market_api_keys"."admin_grant_id" is not null)),
	CONSTRAINT "market_api_keys_spend_limit_check" CHECK (
        (
          "market_api_keys"."key_class" = 'public'
          and (
            ("market_api_keys"."spend_limit_usd" is null and "market_api_keys"."spend_window_days" is null)
            or (
              "market_api_keys"."spend_limit_usd" is not null
              and "market_api_keys"."spend_window_days" is not null
              and "market_api_keys"."spend_limit_usd" > 0
              and scale("market_api_keys"."spend_limit_usd") = 0
              and "market_api_keys"."spend_window_days" between 1 and 30
            )
          )
        )
        or (
          "market_api_keys"."key_class" = 'private'
          and "market_api_keys"."spend_limit_usd" is null
          and "market_api_keys"."spend_window_days" is null
        )
      ),
	CONSTRAINT "market_api_keys_revision_check" CHECK (
        (
          "market_api_keys"."key_class" = 'public'
          and "market_api_keys"."spend_limit_revision" is not null
          and "market_api_keys"."spend_limit_revision" > 0
          and "market_api_keys"."spend_limit_updated_at" is not null
        )
        or ("market_api_keys"."key_class" = 'private' and "market_api_keys"."spend_limit_revision" is null and "market_api_keys"."spend_limit_updated_at" is null)
      ),
	CONSTRAINT "market_api_keys_provider_observation_check" CHECK (
        (
          "market_api_keys"."provider_observed_revision" is null
          and "market_api_keys"."provider_quantum_nano_usd" is null
          and "market_api_keys"."provider_limit_units" is null
          and "market_api_keys"."provider_remaining_units" is null
          and "market_api_keys"."provider_duration_ms" is null
          and "market_api_keys"."provider_reset_at" is null
          and "market_api_keys"."provider_decision" is null
          and "market_api_keys"."provider_observed_at" is null
        )
        or (
          "market_api_keys"."key_class" = 'public'
          and "market_api_keys"."provider_observed_revision" is not null
          and "market_api_keys"."provider_observed_revision" between 1 and "market_api_keys"."spend_limit_revision"
          and "market_api_keys"."provider_quantum_nano_usd" is not null
          and "market_api_keys"."provider_quantum_nano_usd" > 0
          and scale("market_api_keys"."provider_quantum_nano_usd") = 0
          and "market_api_keys"."provider_limit_units" is not null
          and "market_api_keys"."provider_limit_units" between 1 and 9007199254740991
          and scale("market_api_keys"."provider_limit_units") = 0
          and "market_api_keys"."provider_remaining_units" is not null
          and "market_api_keys"."provider_remaining_units" between 0 and "market_api_keys"."provider_limit_units"
          and scale("market_api_keys"."provider_remaining_units") = 0
          and "market_api_keys"."provider_duration_ms" is not null
          and "market_api_keys"."provider_duration_ms" between 1 and 9007199254740991
          and scale("market_api_keys"."provider_duration_ms") = 0
          and "market_api_keys"."provider_reset_at" is not null
          and "market_api_keys"."provider_decision" is not null
          and "market_api_keys"."provider_decision" in ('allowed', 'rate_limited')
          and "market_api_keys"."provider_observed_at" is not null
        )
      ),
	CONSTRAINT "market_api_keys_revocation_check" CHECK ("market_api_keys"."provider_revoked_at" is null or "market_api_keys"."revocation_requested_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "market_api_usage_completions" (
	"event_id" text PRIMARY KEY NOT NULL,
	"result_class" text NOT NULL,
	"http_status" integer NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_api_usage_completions_result_status_check" CHECK (
        ("market_api_usage_completions"."result_class" = 'success' and "market_api_usage_completions"."http_status" between 200 and 399)
        or ("market_api_usage_completions"."result_class" = 'client_error' and "market_api_usage_completions"."http_status" between 400 and 499)
        or ("market_api_usage_completions"."result_class" = 'server_error' and "market_api_usage_completions"."http_status" between 500 and 599)
      )
);
--> statement-breakpoint
CREATE TABLE "market_api_usage_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usage_owner_id" text NOT NULL,
	"market_api_key_id" text NOT NULL,
	"key_class" text NOT NULL,
	"route_id" text NOT NULL,
	"category" text NOT NULL,
	"resource_id" text NOT NULL,
	"method" text NOT NULL,
	"api_version" text NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"billing_mode" text NOT NULL,
	"billable_quantity" integer NOT NULL,
	"rate_usd_per_1000_reads" numeric,
	"billable_cost_usd" numeric,
	"application_url" text,
	"application_title" text,
	CONSTRAINT "market_api_usage_events_key_class_check" CHECK ("market_api_usage_events"."key_class" in ('public', 'private')),
	CONSTRAINT "market_api_usage_events_resource_check" CHECK ("market_api_usage_events"."resource_id" in ('market_instrument', 'city', 'country', 'currency', 'crypto', 'exchange', 'listing_identity', 'market_hour', 'timezone')),
	CONSTRAINT "market_api_usage_events_method_check" CHECK (("market_api_usage_events"."key_class" = 'public' and "market_api_usage_events"."method" in ('GET', 'HEAD')) or ("market_api_usage_events"."key_class" = 'private' and "market_api_usage_events"."method" = 'POST')),
	CONSTRAINT "market_api_usage_events_version_check" CHECK ("market_api_usage_events"."api_version" = 'v1'),
	CONSTRAINT "market_api_usage_events_normalized_labels_check" CHECK (length(btrim("market_api_usage_events"."route_id")) > 0 and length(btrim("market_api_usage_events"."category")) > 0),
	CONSTRAINT "market_api_usage_events_billing_mode_check" CHECK ("market_api_usage_events"."billing_mode" in ('enabled', 'disabled')),
	CONSTRAINT "market_api_usage_events_billable_check" CHECK (
        (
          "market_api_usage_events"."billable_quantity" = 1
          and "market_api_usage_events"."key_class" = 'public'
          and "market_api_usage_events"."billing_mode" = 'enabled'
          and "market_api_usage_events"."rate_usd_per_1000_reads" is not null
          and "market_api_usage_events"."rate_usd_per_1000_reads" > 0
          and "market_api_usage_events"."billable_cost_usd" is not null
          and "market_api_usage_events"."billable_cost_usd" > 0
          and "market_api_usage_events"."billable_cost_usd" * 1000 = "market_api_usage_events"."rate_usd_per_1000_reads"
        )
        or (
          "market_api_usage_events"."billable_quantity" = 0
          and "market_api_usage_events"."rate_usd_per_1000_reads" is null
          and "market_api_usage_events"."billable_cost_usd" is null
        )
      ),
	CONSTRAINT "market_api_usage_events_attribution_check" CHECK ("market_api_usage_events"."application_title" is null or "market_api_usage_events"."application_url" is not null)
);
--> statement-breakpoint
CREATE TABLE "market_system_state" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "market_system_state_fixed_id_check" CHECK ("market_system_state"."id" = 'standalone-v1'),
	CONSTRAINT "market_system_state_completion_check" CHECK (("market_system_state"."status" = 'preparing' and "market_system_state"."completed_at" is null) or ("market_system_state"."status" = 'ready' and "market_system_state"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "market_usage_owner" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"reference_type" text DEFAULT 'user' NOT NULL,
	"reference_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"status" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"cancel_at_period_end" boolean,
	"seats" integer,
	"trial_start" timestamp with time zone,
	"trial_end" timestamp with time zone,
	"metadata" jsonb,
	CONSTRAINT "subscription_plan_check" CHECK ("subscription"."plan" = 'payg'),
	CONSTRAINT "subscription_reference_type_check" CHECK ("subscription"."reference_type" in ('user', 'organization')),
	CONSTRAINT "subscription_default_user_id_check" CHECK ("subscription"."reference_type" <> 'user' or "subscription"."id" = 'sub_default_' || "subscription"."reference_id"),
	CONSTRAINT "subscription_period_check" CHECK ("subscription"."period_start" is null or "subscription"."period_end" is null or "subscription"."period_end" >= "subscription"."period_start"),
	CONSTRAINT "subscription_seats_check" CHECK ("subscription"."seats" is null or "subscription"."seats" > 0)
);
--> statement-breakpoint
CREATE TABLE "system_admin" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_admin_status_check" CHECK ("system_admin"."status" in ('active', 'removing'))
);
--> statement-breakpoint
CREATE TABLE "user_stats" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"usage_owner_id" text NOT NULL,
	"billing_reference_id" text NOT NULL,
	"total_request_quantity" numeric DEFAULT '0' NOT NULL,
	"current_period_request_quantity" numeric DEFAULT '0' NOT NULL,
	"last_period_request_quantity" numeric DEFAULT '0' NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"current_period_cost" numeric DEFAULT '0' NOT NULL,
	"last_period_cost" numeric DEFAULT '0' NOT NULL,
	"billed_overage_this_period" numeric DEFAULT '0' NOT NULL,
	"last_active" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_stats_quantities_check" CHECK (
        "user_stats"."total_request_quantity" >= 0
        and scale("user_stats"."total_request_quantity") = 0
        and "user_stats"."current_period_request_quantity" >= 0
        and scale("user_stats"."current_period_request_quantity") = 0
        and "user_stats"."last_period_request_quantity" >= 0
        and scale("user_stats"."last_period_request_quantity") = 0
      ),
	CONSTRAINT "user_stats_costs_check" CHECK (
        "user_stats"."total_cost" >= 0
        and "user_stats"."current_period_cost" >= 0
        and "user_stats"."last_period_cost" >= 0
        and "user_stats"."billed_overage_this_period" >= 0
        and "user_stats"."billed_overage_this_period" <= "user_stats"."current_period_cost"
      )
);
--> statement-breakpoint
ALTER TABLE "invitation" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "market_keys" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "invitation" CASCADE;--> statement-breakpoint
DROP TABLE "market_keys" CASCADE;--> statement-breakpoint
ALTER TABLE "market_api_key_creation_attempts" ADD CONSTRAINT "market_api_key_creation_attempts_usage_owner_id_market_usage_owner_id_fk" FOREIGN KEY ("usage_owner_id") REFERENCES "public"."market_usage_owner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_key_creation_attempts" ADD CONSTRAINT "market_api_key_creation_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_keys" ADD CONSTRAINT "market_api_keys_usage_owner_id_market_usage_owner_id_fk" FOREIGN KEY ("usage_owner_id") REFERENCES "public"."market_usage_owner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_keys" ADD CONSTRAINT "market_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_usage_completions" ADD CONSTRAINT "market_api_usage_completions_event_id_market_api_usage_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."market_api_usage_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_usage_events" ADD CONSTRAINT "market_api_usage_events_usage_owner_id_market_usage_owner_id_fk" FOREIGN KEY ("usage_owner_id") REFERENCES "public"."market_usage_owner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_api_usage_events" ADD CONSTRAINT "market_api_usage_events_market_api_key_id_market_api_keys_id_fk" FOREIGN KEY ("market_api_key_id") REFERENCES "public"."market_api_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_usage_owner" ADD CONSTRAINT "market_usage_owner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_admin" ADD CONSTRAINT "system_admin_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_stats" ADD CONSTRAINT "user_stats_usage_owner_id_market_usage_owner_id_fk" FOREIGN KEY ("usage_owner_id") REFERENCES "public"."market_usage_owner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_api_key_attempts_reserved_key_id_unique" ON "market_api_key_creation_attempts" USING btree ("reserved_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_api_key_attempts_correlation_id_unique" ON "market_api_key_creation_attempts" USING btree ("correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_api_key_attempts_provider_key_id_unique" ON "market_api_key_creation_attempts" USING btree ("provider_key_id");--> statement-breakpoint
CREATE INDEX "market_api_key_attempts_owner_created_idx" ON "market_api_key_creation_attempts" USING btree ("usage_owner_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_api_keys_unkey_key_id_unique" ON "market_api_keys" USING btree ("unkey_key_id");--> statement-breakpoint
CREATE INDEX "market_api_keys_owner_created_idx" ON "market_api_keys" USING btree ("usage_owner_id","created_at");--> statement-breakpoint
CREATE INDEX "market_api_keys_user_id_idx" ON "market_api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "market_api_keys_admin_grant_id_idx" ON "market_api_keys" USING btree ("admin_grant_id");--> statement-breakpoint
CREATE INDEX "market_api_usage_events_owner_admitted_idx" ON "market_api_usage_events" USING btree ("usage_owner_id","admitted_at","id");--> statement-breakpoint
CREATE INDEX "market_api_usage_events_key_admitted_idx" ON "market_api_usage_events" USING btree ("market_api_key_id","admitted_at","id");--> statement-breakpoint
CREATE INDEX "market_api_usage_events_category_admitted_idx" ON "market_api_usage_events" USING btree ("category","admitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_usage_owner_user_id_unique" ON "market_usage_owner" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscription_reference_status_idx" ON "subscription" USING btree ("reference_type","reference_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_reference_plan_unique" ON "subscription" USING btree ("reference_type","reference_id","plan");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_stripe_subscription_id_unique" ON "subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "system_admin_user_id_unique" ON "system_admin" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "system_admin_status_idx" ON "system_admin" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_stats_user_id_unique" ON "user_stats" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_stats_usage_owner_id_unique" ON "user_stats" USING btree ("usage_owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_stats_billing_reference_id_unique" ON "user_stats" USING btree ("billing_reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_stripe_customer_id_unique" ON "user" USING btree ("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "impersonated_by";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "banned";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "ban_reason";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "ban_expires";