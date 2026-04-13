import { sql, type SQL } from "drizzle-orm";
import type { PluginContext } from "@/lib/market-api/plugins/types";
import { triggerEntityEnrichersInBackground } from "@/lib/market-api/plugins/runtime";

import { db } from "@tradinggoose/db";
import { resolveIconUrl } from "./utils";
import type { CurrencyPair, CurrencyPairFilters, CurrencyRow } from "./types";
import { uniqueNonEmpty } from "./parsing";

function resolveCurrencyIcon(request: Request, row: CurrencyRow) {
  return { ...row, iconUrl: resolveIconUrl(request, row.iconUrl) };
}

async function fetchCurrencies(filters: SQL[], limit: number): Promise<CurrencyRow[]> {
  if (!db) return [];
  const whereClause = filters.length ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const rows = (await db.execute(sql`
    SELECT
      id,
      code,
      name,
      icon_url AS "iconUrl",
      rank
    FROM currencies
    ${whereClause}
    ORDER BY rank DESC, code ASC
    LIMIT ${limit}
  `)) as unknown as CurrencyRow[];
  return rows;
}

export async function buildCurrencyPairs(
  request: Request,
  filters: CurrencyPairFilters,
  limit: number,
  plugin?: PluginContext
): Promise<CurrencyPair[]> {
  const baseQuery = filters.baseQuery?.trim() ?? null;

  const quoteCodes = uniqueNonEmpty(filters.quoteCodes).map((code) => code.toUpperCase());
  const quoteNames = uniqueNonEmpty(filters.quoteNames);
  const quoteQuery = filters.quoteQuery?.trim() ?? null;

  const hasBaseFilters = Boolean(baseQuery);
  const hasQuoteFilters = Boolean(quoteCodes.length || quoteNames.length || quoteQuery);

  const baseFilters: SQL[] = [];
  if (baseQuery) {
    const pattern = `%${baseQuery}%`;
    baseFilters.push(sql`(code ILIKE ${pattern} OR name ILIKE ${pattern})`);
  }

  const quoteFilters: SQL[] = [];
  if (quoteCodes.length) {
    quoteFilters.push(sql`code IN (${sql.join(quoteCodes.map((code) => sql`${code}`), sql`, `)})`);
  }
  if (quoteNames.length) {
    const nameFilters = quoteNames.map((name) => sql`name ILIKE ${`%${name}%`}`);
    quoteFilters.push(sql`(${sql.join(nameFilters, sql` OR `)})`);
  }
  if (quoteQuery) {
    const pattern = `%${quoteQuery}%`;
    quoteFilters.push(sql`(code ILIKE ${pattern} OR name ILIKE ${pattern})`);
  }

  const baseLimit = hasBaseFilters ? Math.min(limit, 200) : Math.min(25, limit);
  const quoteLimit = hasQuoteFilters ? Math.min(limit, 200) : Math.min(25, limit);

  const bases = await fetchCurrencies(baseFilters, baseLimit);
  const quotes = await fetchCurrencies(quoteFilters, quoteLimit);

  if (plugin) {
    triggerEntityEnrichersInBackground(plugin, "currency", "search", bases);
    triggerEntityEnrichersInBackground(plugin, "currency", "search", quotes);
  }

  if (!bases.length || !quotes.length) {
    return [];
  }

  const resolvedBases = bases.map((row) => resolveCurrencyIcon(request, row));
  const resolvedQuotes = quotes.map((row) => resolveCurrencyIcon(request, row));

  const results: Array<{ pairRank: number; currency_base: CurrencyRow; currency_quote: CurrencyRow }> = [];
  for (const base of resolvedBases) {
    for (const quote of resolvedQuotes) {
      if (base.id === quote.id) continue;
      if (base.code.toUpperCase() === quote.code.toUpperCase()) continue;
      const pairRank = base.rank ?? 0;
      results.push({ pairRank, currency_base: base, currency_quote: quote });
    }
  }

  results.sort((a, b) => {
    if (b.pairRank !== a.pairRank) return b.pairRank - a.pairRank;
    const baseDiff = a.currency_base.code.localeCompare(b.currency_base.code);
    if (baseDiff !== 0) return baseDiff;
    return a.currency_quote.code.localeCompare(b.currency_quote.code);
  });

  return results.slice(0, limit).map(({ pairRank: _pairRank, ...pair }) => pair);
}
