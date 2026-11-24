import { sql } from "drizzle-orm";
import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

import { requirePrivateRankActor } from "../rank-access";


async function resolveListingId(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromQuery = searchParams.get("listing_id")?.trim();
  if (fromQuery) return fromQuery;

  try {
    const body = (await request.json()) as {
      listing_id?: string;
    } | null;
    const candidate = body?.listing_id;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  } catch {
    // ignore invalid JSON
  }

  return null;
}

export async function postUpdateListingRank(c: ApiContext, actor: MarketApiActor | null) {
  try {

    const accessError = requirePrivateRankActor(c, actor);
    if (accessError) return accessError;

    const request = c.req.raw;
    const listingId = await resolveListingId(request);
    if (!listingId) {
      return c.json({ error: "listing_id is required." }, 400);
    }

    const updated = await requireDatabase()
      .update(schema.listings)
      .set({
        rank: sql<number>`${schema.listings.rank} + 1`,
        updatedAt: sql`now()`
      })
      .where(sql`${schema.listings.id} = ${listingId}`)
      .returning({ id: schema.listings.id, rank: schema.listings.rank });

    const row = updated[0];
    if (!row) {
      return c.json({ error: "Listing not found." }, 404);
    }

    return c.json({ data: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[update/listing-rank] API error:", message);
    return c.json({ error: message }, 500);
  }
}
