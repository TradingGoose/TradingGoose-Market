import { sql } from "drizzle-orm";
import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

import { requirePrivateRankActor } from "../rank-access";


type CryptoLookup = {
  id?: string | null;
  code?: string | null;
  chainCode?: string | null;
  address?: string | null;
};

function normalizeLookup(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function resolveCryptoId(request: Request): Promise<string | null> {
  const { searchParams } = new URL(request.url);
  const fromQuery = normalizeLookup(searchParams.get("crypto_id") ?? searchParams.get("cryptoId"));
  if (fromQuery) return fromQuery;

  const lookup: CryptoLookup = {
    code: normalizeLookup(searchParams.get("code") ?? searchParams.get("crypto_code")),
    chainCode: normalizeLookup(searchParams.get("chain_code") ?? searchParams.get("chainCode")),
    address: normalizeLookup(searchParams.get("address"))
  };

  try {
    const body = (await request.json()) as
      | { crypto_id?: string; cryptoId?: string; code?: string; crypto_code?: string; chain_code?: string; chainCode?: string; address?: string }
      | null;
    const candidate = normalizeLookup(body?.crypto_id ?? body?.cryptoId);
    if (candidate) return candidate;

    if (!lookup.code && (body?.code || body?.crypto_code)) {
      lookup.code = normalizeLookup(body?.code ?? body?.crypto_code);
    }
    if (!lookup.chainCode && (body?.chain_code || body?.chainCode)) {
      lookup.chainCode = normalizeLookup(body?.chain_code ?? body?.chainCode);
    }
    if (!lookup.address && body?.address) {
      lookup.address = normalizeLookup(body.address);
    }
  } catch {
    // ignore invalid JSON
  }

  if (!lookup.code || !lookup.chainCode) return null;

  const rows = (await requireDatabase().execute(sql`
    SELECT cr.id
    FROM cryptos cr
    WHERE cr.code ILIKE ${lookup.code}
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(cr.contract_addresses) AS c
        JOIN chains ch ON ch.id = c->>'chainId'
        WHERE ch.code ILIKE ${lookup.chainCode}
          ${lookup.address ? sql`AND c->>'address' ILIKE ${lookup.address}` : sql``}
      )
    ORDER BY cr.code ASC
    LIMIT 1
  `)) as { id: string }[];

  return rows[0]?.id ?? null;
}

export async function postUpdateCryptoRank(c: ApiContext, actor: MarketApiActor | null) {
  try {

    const accessError = requirePrivateRankActor(c, actor);
    if (accessError) return accessError;

    const request = c.req.raw;
    const cryptoId = await resolveCryptoId(request);
    if (!cryptoId) {
      return c.json({ error: "crypto_id or code+chainCode is required." }, 400);
    }

    const updated = await requireDatabase()
      .update(schema.cryptos)
      .set({
        rank: sql<number>`${schema.cryptos.rank} + 1`,
        updatedAt: sql`now()`
      })
      .where(sql`${schema.cryptos.id} = ${cryptoId}`)
      .returning({ id: schema.cryptos.id, rank: schema.cryptos.rank });

    const row = updated[0];
    if (!row) {
      return c.json({ error: "Crypto not found." }, 404);
    }

    return c.json({ data: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[update/crypto-rank] API error:", message);
    return c.json({ error: message }, 500);
  }
}
