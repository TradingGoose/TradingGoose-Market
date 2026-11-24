import { sql } from "drizzle-orm";
import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

import { requireDatabase } from "@/lib/db/runtime";

import { requirePrivateRankActor } from "../../rank-access";


export async function postDecayCryptoRank(c: ApiContext, actor: MarketApiActor | null) {
  try {

    const accessError = requirePrivateRankActor(c, actor);
    if (accessError) return accessError;

    const [result] = (await requireDatabase().execute(sql`
      WITH updated AS (
        UPDATE cryptos
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
    console.error("[update/crypto-rank:decay] API error:", message);
    return c.json({ error: message }, 500);
  }
}
