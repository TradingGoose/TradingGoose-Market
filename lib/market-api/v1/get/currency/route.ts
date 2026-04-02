import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";
import { runEntityEnrichers } from "@/lib/market-api/plugins/runtime";

import { db } from "@tradinggoose/db";
import { fetchCurrenciesByIds, fetchCurrencyById } from "../../search/currencies/route";
import { parseListParam } from "../../search/parsing";
import { resolveSearchParams } from "../../search/params";

const MAX_BATCH = 200;

export async function getCurrency(c: ApiContext, plugin?: PluginContext) {
  try {
    if (!db) {
      return c.json({ error: "Database connection is not configured." }, 503);
    }

    const request = c.req.raw;
    const searchParams = await resolveSearchParams(request);
    const currencyIds = parseListParam(searchParams, "currency_id");

    if (!currencyIds.length) {
      return c.json({ error: "currency_id is required." }, 400);
    }
    if (currencyIds.length > MAX_BATCH) {
      return c.json({ error: `currency_id supports up to ${MAX_BATCH} values.` }, 400);
    }

    if (currencyIds.length === 1) {
      const currency = await fetchCurrencyById(request, currencyIds[0] ?? "");
      if (!currency) {
        return c.json({ data: null, error: "Currency not found." }, 404);
      }
      const [data] = plugin ? await runEntityEnrichers(plugin, "currency", "get", [currency]) : [currency];
      return c.json({ data: data ?? currency });
    }

    const resolved = await fetchCurrenciesByIds(request, currencyIds);
    const rows = currencyIds
      .map((id) => resolved.get(id))
      .filter((row): row is NonNullable<typeof row> => row != null);
    const enrichedRows = plugin ? await runEntityEnrichers(plugin, "currency", "get", rows) : rows;
    const enrichedById = new Map(enrichedRows.map((row) => [row.id, row] as const));
    const data: Record<string, Awaited<ReturnType<typeof fetchCurrencyById>> | null> = {};
    for (const id of currencyIds) {
      data[id] = enrichedById.get(id) ?? resolved.get(id) ?? null;
    }
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[get/currency] API error:", message);
    return c.json({ error: message }, 500);
  }
}
