import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";
import { runEntityEnrichers } from "@/lib/market-api/plugins/runtime";

import { db } from "@tradinggoose/db";
import { fetchListingById, fetchListingsByIds } from "../../search/listings/route";
import { parseListParam } from "../../search/parsing";
import { resolveSearchParams } from "../../search/params";

const MAX_BATCH = 200;

export async function getListing(c: ApiContext, plugin?: PluginContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const listingIds = parseListParam(searchParams, "listing_id");

    if (!listingIds.length) {
      return c.json({ error: "listing_id is required." }, 400);
    }
    if (listingIds.length > MAX_BATCH) {
      return c.json({ error: `listing_id supports up to ${MAX_BATCH} values.` }, 400);
    }

    if (listingIds.length === 1) {
      const listing = await fetchListingById(request, listingIds[0] ?? "", {
        forceLogoRefresh: true
      });
      if (!listing) {
        return c.json({ data: null, error: "Listing not found." }, 404);
      }
      const [data] = plugin ? await runEntityEnrichers(plugin, "listing", "get", [listing]) : [listing];
      return c.json({ data: data ?? listing });
    }

    const resolved = await fetchListingsByIds(request, listingIds, { forceLogoRefresh: true });
    const rows = listingIds
      .map((id) => resolved.get(id))
      .filter((row): row is NonNullable<typeof row> => row != null);
    const enrichedRows = plugin ? await runEntityEnrichers(plugin, "listing", "get", rows) : rows;
    const enrichedById = new Map(
      enrichedRows
        .map((row) => [row.listing_id, row] as const)
        .filter(([id]) => Boolean(id))
    );
    const data: Record<string, Awaited<ReturnType<typeof fetchListingById>> | null> = {};
    for (const id of listingIds) {
      data[id] = enrichedById.get(id) ?? resolved.get(id) ?? null;
    }
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[get/listing] API error:", message);
    return c.json({ error: message }, 500);
  }
}
