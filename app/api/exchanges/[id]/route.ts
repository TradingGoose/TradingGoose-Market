import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchExchangesFromDb } from "../lib";
import { apiRequireEditor } from "@/lib/auth/session";

const updateExchangeSchema = z
  .object({
    mic: z.string().trim().min(1).max(16).optional(),
    name: z.union([z.string().trim().max(255), z.literal(""), z.null()]).optional(),
    lei: z.union([z.string().trim().max(32), z.literal(""), z.null()]).optional(),
    url: z.union([z.string().trim().max(2048), z.literal(""), z.null()]).optional(),
    createdAt: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    expiredAt: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    countryId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    cityId: z.union([z.string().trim(), z.literal(""), z.null()]).optional(),
    active: z.boolean().optional(),
    isSegment: z.boolean().optional(),
    parentId: z.union([z.string().trim(), z.literal(""), z.null()]).optional()
  })
  .refine(value => Object.keys(value).length > 0, {
    message: "At least one field must be provided."
  });

type UpdateExchangeInput = z.infer<typeof updateExchangeSchema>;

function normalizeNullable(value: UpdateExchangeInput[keyof UpdateExchangeInput]) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value as string | null;
}

function parseOptionalDate(value?: string | null) {
  const normalized = normalizeNullable(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date value.");
  }
  return parsed;
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

  const { id: exchangeId } = await params;
  if (!exchangeId) {
    return NextResponse.json({ error: "Exchange id is required." }, { status: 400 });
  }

  let payload: UpdateExchangeInput;
  try {
    payload = updateExchangeSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};

  if (payload.mic !== undefined) updateData.mic = payload.mic;
  if (payload.name !== undefined) updateData.name = normalizeNullable(payload.name);
  if (payload.lei !== undefined) updateData.lei = normalizeNullable(payload.lei);
  if (payload.url !== undefined) updateData.url = normalizeNullable(payload.url);
  try {
    if (payload.createdAt !== undefined) updateData.createdAt = parseOptionalDate(payload.createdAt);
    if (payload.expiredAt !== undefined) updateData.expiredAt = parseOptionalDate(payload.expiredAt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid date value.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (payload.countryId !== undefined) updateData.countryId = normalizeNullable(payload.countryId);
  if (payload.cityId !== undefined) updateData.cityId = normalizeNullable(payload.cityId);
  if (payload.active !== undefined) updateData.active = payload.active;
  if (payload.isSegment !== undefined) updateData.isSegment = payload.isSegment;
  if (payload.parentId !== undefined) updateData.parentId = normalizeNullable(payload.parentId);
  if (payload.isSegment === false) updateData.parentId = null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.exchanges)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.exchanges.id, exchangeId))
      .returning({ id: schema.exchanges.id });

    if (!result.length) {
      return NextResponse.json({ error: "Exchange not found." }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update exchange.";
    console.error("[exchanges:update] API error:", message);
    return NextResponse.json({ error: "Failed to update exchange." }, { status: 500 });
  }

  const refreshed = await fetchExchangesFromDb({
    page: 1,
    pageSize: 1,
    id: exchangeId
  });

  const updatedExchange = refreshed.data.find(row => row.id === exchangeId) ?? null;

  return NextResponse.json({ data: updatedExchange });
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

  const { id: exchangeId } = await params;
  if (!exchangeId) {
    return NextResponse.json({ error: "Exchange id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.exchanges.id })
    .from(schema.exchanges)
    .where(eq(schema.exchanges.id, exchangeId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Exchange not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.exchanges).where(eq(schema.exchanges.id, exchangeId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete exchange.";
    console.error("[exchanges:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete exchange." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: exchangeId } });
}
