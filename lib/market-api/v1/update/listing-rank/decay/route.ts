import { sql } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";

import { db } from "@tradinggoose/db";
import { requireRankUpdateAccess } from "../../rank-access";

export async function postDecayListingRank(c: ApiContext, plugin?: PluginContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const accessError = requireRankUpdateAccess(c, plugin);
    if (accessError) return accessError;

    const [result] = (await db.execute(sql`
      WITH updated AS (
        UPDATE listings
        SET
          rank = CASE
            WHEN rank <= 1 THEN 0
            ELSE rank / 2
          END,
          updated_at = now()
        WHERE rank > 0
        RETURNING 1
      )
      SELECT COUNT(*)::int AS updated FROM updated
    `)) as { updated: number }[];

    return c.json({ data: { updated: result?.updated ?? 0 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[update/listing-rank:decay] API error:", message);
    return c.json({ error: message }, 500);
  }
}
