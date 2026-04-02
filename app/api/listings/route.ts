import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import {
  fetchListingsFromDb,
  type ListingsQuery,
  extractPgErrorCode,
  extractPgConstraint,
  resolveCurrencyId,
  resolveExchId,
  resolveMarketId,
  resolveExchIds
} from "./lib";
import { apiRequireEditor } from "@/lib/auth/session";
import { parsePositiveInt, normalizeNullableString, parseBoolean } from "@/lib/api-utils";
import {
  runAppRouteAdminReadEnrichers,
  runAppRouteAfterWriteEnricher
} from "@/lib/market-api/plugins/app-routes";

export const runtime = "nodejs";

const iconUrlSchema = z.union([
  z.string().trim().url(),
  z.string().trim().regex(/^\/|^api\/files\/serve\/|^icons\//i),
  z.literal(""),
  z.null()
]);

const createListingSchema = z.object({
  base: z.string().trim().min(1).max(64),
  quote: z.union([z.string().trim().max(32), z.literal(""), z.null()]).optional(),
  name: z.union([z.string().trim().max(255), z.literal(""), z.null()]).optional(),
  marketId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
  primaryExchId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
  secondaryExchIds: z.array(z.string().trim().min(1)).max(50).optional(),
  active: z.boolean().optional(),
  assetClass: z
    .enum(["stock", "etf", "indice", "mutualfund", "future"])
    .optional(),
  iconUrl: iconUrlSchema.optional()
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    if (!db) {
      return NextResponse.json(
        { data: [], total: 0, error: "Database connection is not configured." },
        { status: 503 }
      );
    }

    const page = parsePositiveInt(searchParams.get("page"), 1);
    const pageSize = parsePositiveInt(searchParams.get("pageSize"), 10, 100);

    const id = searchParams.get("id")?.trim();
    const assetClass = searchParams.get("assetClass")?.trim().toLowerCase();
    const base = searchParams.get("base")?.toLowerCase().trim();
    const quoteParam = searchParams.get("quote")?.trim();
    const marketIdParam = searchParams.get("marketId")?.trim();
    const primaryExchIdParam = searchParams.get("primaryExchId")?.trim();
    const countryIdParam = searchParams.get("countryId")?.trim();
    const quote = quoteParam === "__null__" ? null : quoteParam || undefined;
    const marketId = marketIdParam === "__null__" ? null : marketIdParam || undefined;
    const primaryExchId = primaryExchIdParam === "__null__" ? null : primaryExchIdParam || undefined;
    const countryId = countryIdParam === "__null__" ? null : countryIdParam || undefined;
    const active = parseBoolean(searchParams.get("active"));

    const query: ListingsQuery = {
      page,
      pageSize,
      id,
      assetClass,
      base,
      quote,
      marketId,
      primaryExchId,
      countryId,
      active
    };

    const payload = await fetchListingsFromDb(query);
    const data = await runAppRouteAdminReadEnrichers(request, "listing", payload.data);

    return NextResponse.json({ ...payload, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[listings] API error:", error);
    return NextResponse.json({ data: [], total: 0, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  let payload: z.infer<typeof createListingSchema>;
  try {
    const body = await request.json();
    if (body && typeof body === "object" && "iconUrl" in body) {
      const iconUrl = (body as { iconUrl?: unknown }).iconUrl;
      if (typeof iconUrl === "string" ? iconUrl.trim().length > 0 : iconUrl != null) {
        return NextResponse.json(
          { error: "iconUrl can only be set via the upload endpoint." },
          { status: 400 }
        );
      }
    }
    payload = createListingSchema.parse(body);
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const base = payload.base.trim();
  const quote = normalizeNullableString(payload.quote) ?? null;
  const name = normalizeNullableString(payload.name) ?? null;
  const marketInput = normalizeNullableString(payload.marketId) ?? null;
  const primaryExchInput = normalizeNullableString(payload.primaryExchId) ?? null;
  const secondaryExchInputs = Array.from(new Set(payload.secondaryExchIds ?? []));
  const active = payload.active ?? true;
  const assetClass = payload.assetClass ?? "stock";
  const iconUrl = null;

  const resolvedQuoteId = await resolveCurrencyId(quote);
  if (quote && !resolvedQuoteId) {
    return NextResponse.json({ error: "Quote currency not found." }, { status: 400 });
  }

  const resolvedMarketId = await resolveMarketId(marketInput);
  if (marketInput && !resolvedMarketId) {
    return NextResponse.json({ error: "Market not found." }, { status: 400 });
  }

  const resolvedPrimaryExchId = await resolveExchId(primaryExchInput);
  if (primaryExchInput && !resolvedPrimaryExchId) {
    return NextResponse.json({ error: "Primary exchange not found." }, { status: 400 });
  }

  const resolvedSecondaryExchIds = await resolveExchIds(secondaryExchInputs);
  if (secondaryExchInputs.length && resolvedSecondaryExchIds.length !== secondaryExchInputs.length) {
    return NextResponse.json({ error: "One or more secondary exchanges were not found." }, { status: 400 });
  }

  let newId: string | null = null;
  try {
    const result = await db
      .insert(schema.listings)
      .values({
        base,
        quote: resolvedQuoteId,
        name,
        marketId: resolvedMarketId,
        primaryExchId: resolvedPrimaryExchId,
        secondaryExchIds: resolvedSecondaryExchIds.length ? resolvedSecondaryExchIds : null,
        active,
        assetClass,
        iconUrl
      })
      .returning({ id: schema.listings.id });

    newId = result[0]?.id ?? null;
  } catch (error: any) {
    const code = extractPgErrorCode(error);
    const constraint = extractPgConstraint(error);
    if (code === "23505" || constraint === "listings_base_quote_primary_exch_idx") {
      return NextResponse.json(
        { error: "Listing already exists for the same base, quote, primary exchange, asset class, and market." },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to create listing.";
    console.error("[listings:create] API error:", error);
    return NextResponse.json({ error: "Failed to create listing." }, { status: 500 });
  }

  if (!newId) {
    return NextResponse.json({ error: "Failed to create listing." }, { status: 500 });
  }

  const refreshed = await fetchListingsFromDb({
    page: 1,
    pageSize: 1,
    id: newId
  });

  const createdListing = refreshed.data.find((row) => row.id === newId) ?? null;
  const data = await runAppRouteAfterWriteEnricher(request, "listing", createdListing, auth.user.id);

  return NextResponse.json({ data }, { status: 201 });
}
