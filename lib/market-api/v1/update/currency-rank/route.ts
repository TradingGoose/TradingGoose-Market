import { sql } from "drizzle-orm";
import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

import { requirePrivateRankActor } from "../rank-access";


async function resolveCurrencyId(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get("currency_id")?.trim() ?? searchParams.get("currencyId")?.trim();
  if (fromQuery) return fromQuery;
  const code = searchParams.get("currency_code")?.trim() ?? searchParams.get("code")?.trim();

  try {
    const body = (await request.json()) as
      | { currency_id?: string; currencyId?: string; currency_code?: string; code?: string }
      | null;
    const candidate = body?.currency_id ?? body?.currencyId;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (!code && (body?.currency_code || body?.code)) {
      const bodyCode = body.currency_code ?? body.code;
      if (typeof bodyCode === "string" && bodyCode.trim()) {
        return bodyCode.trim();
      }
    }
  } catch {
    // ignore invalid JSON
  }

  if (code) {
    const result = (await requireDatabase().execute(sql`
      SELECT id FROM currencies
      WHERE code ILIKE ${code}
      ORDER BY code ASC
      LIMIT 1
    `)) as { id: string }[];
    return result[0]?.id ?? null;
  }

  return code ?? null;
}

export async function postUpdateCurrencyRank(c: ApiContext, actor: MarketApiActor | null) {
  try {

    const accessError = requirePrivateRankActor(c, actor);
    if (accessError) return accessError;

    const request = c.req.raw;
    const currencyId = await resolveCurrencyId(request);
    if (!currencyId) {
      return c.json({ error: "currency_id is required." }, 400);
    }

    const updated = await requireDatabase()
      .update(schema.currencies)
      .set({
        rank: sql<number>`${schema.currencies.rank} + 1`,
        updatedAt: sql`now()`
      })
      .where(sql`${schema.currencies.id} = ${currencyId}`)
      .returning({ id: schema.currencies.id, rank: schema.currencies.rank });

    const row = updated[0];
    if (!row) {
      return c.json({ error: "Currency not found." }, 404);
    }

    return c.json({ data: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[update/currency-rank] API error:", message);
    return c.json({ error: message }, 500);
  }
}
