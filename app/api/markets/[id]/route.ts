import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchMarketsFromDb } from "../lib";
import { apiRequireEditor } from "@/lib/auth/session";

const updateMarketSchema = z
  .object({
    code: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    countryId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
    cityId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    timeZoneId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    url: z.union([z.string().trim().max(2048), z.literal(""), z.null()]).optional()
  })
  .refine(value => Object.keys(value).length > 0, {
    message: "At least one field must be provided."
  });

type UpdateMarketInput = z.infer<typeof updateMarketSchema>;

function normalizeNullable(value: UpdateMarketInput[keyof UpdateMarketInput]) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value as string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const { id: marketId } = await params;
  if (!marketId) {
    return NextResponse.json({ error: "Market id is required." }, { status: 400 });
  }

  let payload: UpdateMarketInput;
  try {
    payload = updateMarketSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (payload.code !== undefined) updateData.code = payload.code;
  if (payload.name !== undefined) updateData.name = payload.name;
  if (payload.countryId !== undefined) updateData.countryId = normalizeNullable(payload.countryId);
  if (payload.cityId !== undefined) updateData.cityId = normalizeNullable(payload.cityId);
  if (payload.timeZoneId !== undefined) updateData.timeZoneId = normalizeNullable(payload.timeZoneId);
  if (payload.url !== undefined) updateData.url = normalizeNullable(payload.url);

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.markets)
      .set({ ...updateData })
      .where(eq(schema.markets.id, marketId))
      .returning({ id: schema.markets.id });

    if (!result.length) {
      return NextResponse.json({ error: "Market not found." }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update market.";
    console.error("[markets:update] API error:", message);
    return NextResponse.json({ error: "Failed to update market." }, { status: 500 });
  }

  const refreshed = await fetchMarketsFromDb({
    page: 1,
    pageSize: 1,
    id: marketId
  });

  const updatedMarket = refreshed.data.find(row => row.id === marketId) ?? null;

  return NextResponse.json({ data: updatedMarket });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const { id: marketId } = await params;
  if (!marketId) {
    return NextResponse.json({ error: "Market id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.id, marketId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.markets).where(eq(schema.markets.id, marketId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete market.";
    console.error("[markets:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete market." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: marketId } });
}
