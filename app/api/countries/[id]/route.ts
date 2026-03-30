import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchCountriesFromDb } from "../lib";

const updateCountrySchema = z
  .object({
    code: z.string().trim().min(2).max(10).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    iconUrl: z.union([z.string().url().trim(), z.literal(""), z.null()]).optional()
  })
  .refine(value => Object.keys(value).length > 0, { message: "At least one field must be provided." });

type UpdateCountryInput = z.infer<typeof updateCountrySchema>;

function normalizeNullable(value: UpdateCountryInput[keyof UpdateCountryInput]) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value as string | null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  if (!db) {
    return NextResponse.json(
      { error: "Database connection is not configured." },
      { status: 503 }
    );
  }

  const { id: countryId } = await params;
  if (!countryId) {
    return NextResponse.json({ error: "Country id is required." }, { status: 400 });
  }

  let payload: UpdateCountryInput;
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
    payload = updateCountrySchema.parse(body);
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
      .update(schema.countries)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.countries.id, countryId))
      .returning({ id: schema.countries.id });

    if (!result.length) {
      return NextResponse.json({ error: "Country not found." }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update country.";
    console.error("[countries:update] API error:", message);
    return NextResponse.json({ error: "Failed to update country." }, { status: 500 });
  }

  const refreshed = await fetchCountriesFromDb({
    page: 1,
    pageSize: 1,
    id: countryId
  });

  const updatedCountry = refreshed.data.find(row => row.id === countryId) ?? null;

  return NextResponse.json({ data: updatedCountry });
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

  const { id: countryId } = await params;
  if (!countryId) {
    return NextResponse.json({ error: "Country id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.countries.id })
    .from(schema.countries)
    .where(eq(schema.countries.id, countryId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Country not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.countries).where(eq(schema.countries.id, countryId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete country.";
    console.error("[countries:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete country." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: countryId } });
}
