import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchCurrenciesFromDb } from "../lib";
import { apiRequireEditor } from "@/lib/auth/session";

const updateCurrencySchema = z
  .object({
    code: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    iconUrl: z.union([z.string().url().trim(), z.literal(""), z.null()]).optional()
  })
  .refine(value => Object.keys(value).length > 0, { message: "At least one field must be provided." });

type UpdateCurrencyInput = z.infer<typeof updateCurrencySchema>;

function normalizeNullable(value: UpdateCurrencyInput[keyof UpdateCurrencyInput]) {
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

  const { id: currencyId } = await params;
  if (!currencyId) {
    return NextResponse.json({ error: "Currency id is required." }, { status: 400 });
  }

  let payload: UpdateCurrencyInput;
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
    payload = updateCurrencySchema.parse(body);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (payload.code !== undefined) updateData.code = payload.code.trim().toUpperCase();
  if (payload.name !== undefined) updateData.name = payload.name.trim();
  if (payload.iconUrl !== undefined) updateData.iconUrl = normalizeNullable(payload.iconUrl);

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.currencies)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.currencies.id, currencyId))
      .returning({ id: schema.currencies.id });

    if (!result.length) {
      return NextResponse.json({ error: "Currency not found." }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update currency.";
    console.error("[currencies:update] API error:", message);
    return NextResponse.json({ error: "Failed to update currency." }, { status: 500 });
  }

  const refreshed = await fetchCurrenciesFromDb({
    page: 1,
    pageSize: 1,
    id: currencyId
  });

  const updatedCurrency = refreshed.data.find(row => row.id === currencyId) ?? null;

  return NextResponse.json({ data: updatedCurrency });
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

  const { id: currencyId } = await params;
  if (!currencyId) {
    return NextResponse.json({ error: "Currency id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.currencies.id })
    .from(schema.currencies)
    .where(eq(schema.currencies.id, currencyId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Currency not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.currencies).where(eq(schema.currencies.id, currencyId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete currency.";
    console.error("[currencies:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete currency." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: currencyId } });
}
