import { sql } from "drizzle-orm";
import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

import { privateRankTransaction } from "../../rank-access";

export async function postDecayCurrencyRank(c: ApiContext, actor: MarketApiActor | null) {
  try {

    const tx = privateRankTransaction(c, actor);
    if (tx instanceof Response) return tx;

    const [result] = (await tx.execute(sql`
      WITH updated AS (
        UPDATE currencies
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
    console.error("[update/currency-rank:decay] API error:", message);
    return c.json({ error: message }, 500);
  }
}
