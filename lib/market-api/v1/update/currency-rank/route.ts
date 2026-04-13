import { sql } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";

import { db, schema } from "@tradinggoose/db";
import { requireRankUpdateAccess } from "../rank-access";

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

  if (code && db) {
    const result = (await db.execute(sql`
      SELECT id FROM currencies
      WHERE code ILIKE ${code}
      ORDER BY code ASC
      LIMIT 1
    `)) as { id: string }[];
    return result[0]?.id ?? null;
  }

  return code ?? null;
}

export async function postUpdateCurrencyRank(c: ApiContext, plugin?: PluginContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const accessError = requireRankUpdateAccess(c, plugin);
    if (accessError) return accessError;

    const request = c.req.raw;
    const currencyId = await resolveCurrencyId(request);
    if (!currencyId) {
      return c.json({ error: "currency_id is required." }, 400);
    }

    const updated = await db
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
