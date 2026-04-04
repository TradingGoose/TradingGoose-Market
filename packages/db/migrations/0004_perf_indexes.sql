CREATE INDEX "cryptos_rank_code_idx" ON "cryptos" USING btree ("rank","code");--> statement-breakpoint
CREATE INDEX "cryptos_asset_type_idx" ON "cryptos" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "exchanges_country_id_idx" ON "exchanges" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "exchanges_market_id_idx" ON "exchanges" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "listings_quote_idx" ON "listings" USING btree ("quote");--> statement-breakpoint
CREATE INDEX "listings_market_id_idx" ON "listings" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "listings_primary_exch_id_idx" ON "listings" USING btree ("primary_exch_id");--> statement-breakpoint
CREATE INDEX "listings_asset_class_idx" ON "listings" USING btree ("asset_class");--> statement-breakpoint
CREATE INDEX "listings_rank_base_idx" ON "listings" USING btree ("rank","base");--> statement-breakpoint
CREATE INDEX "markets_country_id_idx" ON "markets" USING btree ("country_id");