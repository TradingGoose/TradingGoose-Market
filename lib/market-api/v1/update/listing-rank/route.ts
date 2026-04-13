import { sql } from "drizzle-orm";
import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";

import { db, schema } from "@tradinggoose/db";
import { requireRankUpdateAccess } from "../rank-access";

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

export async function postUpdateListingRank(c: ApiContext, plugin?: PluginContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const accessError = requireRankUpdateAccess(c, plugin);
    if (accessError) return accessError;

    const request = c.req.raw;
    const listingId = await resolveListingId(request);
    if (!listingId) {
      return c.json({ error: "listing_id is required." }, 400);
    }

    const updated = await db
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
