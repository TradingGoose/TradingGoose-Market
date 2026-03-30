import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { deleteFile, extractStorageKey } from "@uploads/core/storage-client";
import { fetchListingsFromDb } from "../lib";

const iconUrlSchema = z.union([
  z.string().trim().url(),
  z.string().trim().regex(/^(\/|api\/files\/core\/serve\/|icons\/)/i),
  z.literal(""),
  z.null()
]);

const updateListingSchema = z
  .object({
    base: z.string().trim().min(1).max(64).optional(),
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
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided."
  });

type UpdateListingInput = z.infer<typeof updateListingSchema>;

function normalizeNullableString(value: UpdateListingInput[keyof UpdateListingInput]) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value as string | null;
}

function extractPgErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const anyError = error as { code?: string; cause?: { code?: string } };
  return anyError.code ?? anyError.cause?.code ?? null;
}

function extractPgConstraint(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const anyError = error as { constraint?: string; cause?: { constraint?: string } };
  return anyError.constraint ?? anyError.cause?.constraint ?? null;
}

async function resolveCurrencyId(value: string | null) {
  if (!db) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const result = (await db.execute(sql`
    SELECT id FROM currencies
    WHERE id = ${trimmed} OR code ILIKE ${trimmed}
    ORDER BY CASE WHEN id = ${trimmed} THEN 0 ELSE 1 END
    LIMIT 1
  `)) as { id: string }[];

  return result[0]?.id ?? null;
}

async function resolveExchId(value: string | null) {
  if (!db) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const rows = (await db.execute(sql`
    SELECT id
    FROM exchanges
    WHERE id = ${trimmed}
    LIMIT 1
  `)) as { id: string }[];

  return rows[0]?.id ?? null;
}

async function resolveMarketId(value: string | null) {
  if (!db) return null;
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const rows = (await db.execute(sql`
    SELECT id
    FROM markets
    WHERE id = ${trimmed} OR code ILIKE ${trimmed}
    ORDER BY CASE WHEN id = ${trimmed} THEN 0 ELSE 1 END
    LIMIT 1
  `)) as { id: string }[];

  return rows[0]?.id ?? null;
}

async function resolveExchIds(values: string[]) {
  if (!db) return [] as string[];
  const tokens = Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
  if (!tokens.length) return [] as string[];

  const rows = (await db.execute(sql`
    SELECT id
    FROM exchanges
    WHERE id IN (${sql.join(tokens.map((token) => sql`${token}`), sql`, `)})
  `)) as { id: string }[];

  const idSet = new Set(rows.map((row) => row.id));
  return tokens.filter((token) => idSet.has(token));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: listingId } = await params;
  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  if (!listingId) {
    return NextResponse.json({ error: "Listing id is required." }, { status: 400 });
  }

  let payload: UpdateListingInput;
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
    payload = updateListingSchema.parse(body);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  // Load existing row (for cleanup, fall back to 404 below if not found)
  const existing = (await db
    .select({
      iconUrl: schema.listings.iconUrl,
      base: schema.listings.base,
      quote: schema.listings.quote,
      marketId: schema.listings.marketId,
      primaryExchId: schema.listings.primaryExchId,
      assetClass: schema.listings.assetClass
    })
    .from(schema.listings)
    .where(eq(schema.listings.id, listingId))
    .limit(1)) as {
      iconUrl: string | null;
      base: string;
      quote: string | null;
      marketId: string | null;
      primaryExchId: string | null;
      assetClass: string;
    }[];

  if (payload.base !== undefined) {
    updateData.base = payload.base;
  }
  if (payload.quote !== undefined) {
    const normalized = normalizeNullableString(payload.quote);
    const currencyId = await resolveCurrencyId(normalized ?? null);
    if (normalized && !currencyId) {
      return NextResponse.json({ error: "Quote currency not found." }, { status: 400 });
    }
    updateData.quote = currencyId;
  }
  if (payload.name !== undefined) {
    updateData.name = normalizeNullableString(payload.name);
  }
  if (payload.marketId !== undefined) {
    const normalized = normalizeNullableString(payload.marketId);
    const resolvedMarketId = await resolveMarketId(normalized ?? null);
    if (normalized && !resolvedMarketId) {
      return NextResponse.json({ error: "Market not found." }, { status: 400 });
    }
    updateData.marketId = resolvedMarketId;
  }
  if (payload.primaryExchId !== undefined) {
    const normalized = normalizeNullableString(payload.primaryExchId);
    const resolvedExchId = await resolveExchId(normalized ?? null);
    if (normalized && !resolvedExchId) {
      return NextResponse.json({ error: "Primary exchange not found." }, { status: 400 });
    }
    updateData.primaryExchId = resolvedExchId;
  }
  if (payload.secondaryExchIds !== undefined) {
    const deduped = Array.from(new Set(payload.secondaryExchIds));
    const resolvedSecondary = await resolveExchIds(deduped);
    if (deduped.length && resolvedSecondary.length !== deduped.length) {
      return NextResponse.json({ error: "One or more secondary exchanges were not found." }, { status: 400 });
    }
    updateData.secondaryExchIds = resolvedSecondary;
  }
  if (payload.active !== undefined) {
    updateData.active = payload.active;
  }
  if (payload.assetClass !== undefined) {
    updateData.assetClass = payload.assetClass;
  }
  if (payload.iconUrl !== undefined) {
    const normalized = normalizeNullableString(payload.iconUrl);
    updateData.iconUrl = normalized;

    // If clearing icon and an existing local file was present, delete it
    const prevIcon = existing[0]?.iconUrl;
    if (normalized === null) {
      const prevInfo = extractStorageKey(prevIcon);
      if (prevInfo) {
        try {
          await deleteFile(prevInfo.key, prevInfo.provider);
        } catch (err) {
          console.error("[listings:update] failed to delete previous icon:", err);
        }
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  const existingRow = existing[0];
  if (!existingRow) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const nextBase = (updateData.base as string | undefined) ?? existingRow.base;
  const nextQuote = (updateData.quote as string | null | undefined) ?? existingRow.quote;
  const nextMarketId = (updateData.marketId as string | null | undefined) ?? existingRow.marketId;
  const nextPrimaryExchId =
    (updateData.primaryExchId as string | null | undefined) ?? existingRow.primaryExchId;
  const nextAssetClass = (updateData.assetClass as string | undefined) ?? existingRow.assetClass;

  if (nextPrimaryExchId) {
    const duplicate = (await db.execute(sql`
      SELECT id
      FROM listings
      WHERE base = ${nextBase}
        AND ${nextQuote === null ? sql`quote IS NULL` : sql`quote = ${nextQuote}`}
        AND ${nextMarketId === null ? sql`market_id IS NULL` : sql`market_id = ${nextMarketId}`}
        AND primary_exch_id = ${nextPrimaryExchId}
        AND asset_class = ${nextAssetClass}
        AND id <> ${listingId}
      LIMIT 1
    `)) as { id: string }[];

    if (duplicate.length) {
      return NextResponse.json(
        {
          error: "Listing already exists for the same base, quote, primary exchange, asset class, and market.",
          conflictId: duplicate[0]?.id ?? null
        },
        { status: 409 }
      );
    }
  }

  try {
    const result = await db
      .update(schema.listings)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.listings.id, listingId))
      .returning({ id: schema.listings.id });

    if (!result.length) {
      return NextResponse.json({ error: "Listing not found." }, { status: 404 });
    }

  } catch (error: any) {
    const code = extractPgErrorCode(error);
    const constraint = extractPgConstraint(error);
    if (code === "23505" || constraint === "listings_base_quote_primary_exch_idx") {
      return NextResponse.json(
        { error: "Listing already exists for the same base, quote, primary exchange, asset class, and market." },
        { status: 409 }
      );
    }
    if (code === "23503") {
      return NextResponse.json(
        { error: "Primary exchange or quote currency not found." },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to update listing.";
    console.error("[listings:update] API error:", error);
    return NextResponse.json({ error: "Failed to update listing." }, { status: 500 });
  }

  const refreshed = await fetchListingsFromDb({
    page: 1,
    pageSize: 1,
    id: listingId
  });

  const updatedListing = refreshed.data.find((row) => row.id === listingId) ?? null;

  return NextResponse.json({ data: updatedListing });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const { id: listingId } = await params;
  if (!listingId) {
    return NextResponse.json({ error: "Listing id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ iconUrl: schema.listings.iconUrl })
    .from(schema.listings)
    .where(eq(schema.listings.id, listingId))
    .limit(1)) as { iconUrl: string | null }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.listings).where(eq(schema.listings.id, listingId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete listing.";
    console.error("[listings:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete listing." }, { status: 500 });
  }

  const prevIcon = existing[0]?.iconUrl;
  const prevInfo = extractStorageKey(prevIcon);
  if (prevInfo) {
    try {
      await deleteFile(prevInfo.key, prevInfo.provider);
    } catch (err) {
      console.error("[listings:delete] failed to delete icon:", err);
    }
  }

  return NextResponse.json({ data: { id: listingId } });
}
