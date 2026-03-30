import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchCitiesFromDb } from "../lib";
import { apiRequireEditor } from "@/lib/auth/session";

const updateCitySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    countryId: z.union([z.string().trim().min(1), z.literal(""), z.null()]).optional(),
    timeZoneId: z.string().trim().min(1).optional()
  })
  .refine(value => Object.keys(value).length > 0, { message: "At least one field must be provided." });

type UpdateCityInput = z.infer<typeof updateCitySchema>;

function normalizeNullable(value: UpdateCityInput[keyof UpdateCityInput]) {
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

  const { id: cityId } = await params;
  if (!cityId) {
    return NextResponse.json({ error: "City id is required." }, { status: 400 });
  }

  let payload: UpdateCityInput;
  try {
    payload = updateCitySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (payload.name !== undefined) updateData.name = payload.name;
  if (payload.countryId !== undefined) updateData.countryId = normalizeNullable(payload.countryId);
  if (payload.timeZoneId !== undefined) updateData.timeZoneId = payload.timeZoneId;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.cities)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.cities.id, cityId))
      .returning({ id: schema.cities.id });

    if (!result.length) {
      return NextResponse.json({ error: "City not found." }, { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update city.";
    console.error("[cities:update] API error:", message);
    return NextResponse.json({ error: "Failed to update city." }, { status: 500 });
  }

  const refreshed = await fetchCitiesFromDb({
    page: 1,
    pageSize: 1,
    id: cityId
  });

  const updatedCity = refreshed.data.find(row => row.id === cityId) ?? null;

  return NextResponse.json({ data: updatedCity });
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

  const { id: cityId } = await params;
  if (!cityId) {
    return NextResponse.json({ error: "City id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.cities.id })
    .from(schema.cities)
    .where(eq(schema.cities.id, cityId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "City not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.cities).where(eq(schema.cities.id, cityId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete city.";
    console.error("[cities:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete city." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: cityId } });
}
