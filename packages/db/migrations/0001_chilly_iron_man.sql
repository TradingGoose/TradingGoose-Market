CREATE TABLE "market_billing_outbox" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "market_keys_key_suffix_idx";--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "public_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "secret_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "suffix" text;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "last_used_at" timestamp;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "revoked_at" timestamp;--> statement-breakpoint
ALTER TABLE "market_keys" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "market_billing_outbox_pending_idx" ON "market_billing_outbox" USING btree ("delivered_at","next_retry_at");--> statement-breakpoint
CREATE INDEX "market_billing_outbox_user_id_idx" ON "market_billing_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_keys_public_id_uidx" ON "market_keys" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "market_keys_user_id_idx" ON "market_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "market_keys_status_idx" ON "market_keys" USING btree ("status");--> statement-breakpoint
ALTER TABLE "market_keys" DROP COLUMN "key_hash";--> statement-breakpoint
ALTER TABLE "market_keys" DROP COLUMN "key_suffix";