DROP INDEX "cryptos_rank_code_idx";--> statement-breakpoint
DROP INDEX "listings_rank_base_idx";--> statement-breakpoint
CREATE INDEX "cryptos_rank_code_idx" ON "cryptos" USING btree (rank DESC, code ASC);--> statement-breakpoint
CREATE INDEX "listings_rank_base_idx" ON "listings" USING btree (rank DESC, base ASC);