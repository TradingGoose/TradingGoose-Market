import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "@tradinggoose/db";
import { fetchTimeZonesFromDb } from "../lib";

const updateTimeZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    offset: z.string().trim().min(1).max(32).optional(),
    offsetDst: z.string().trim().min(1).max(32).nullable().optional(),
    observesDst: z.boolean().optional()
  })
  .refine(value => Object.keys(value).length > 0, { message: "At least one field must be provided." });

type UpdateTimeZoneInput = z.infer<typeof updateTimeZoneSchema>;

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

  const { id: timeZoneId } = await params;
  if (!timeZoneId) {
    return NextResponse.json({ error: "Time zone id is required." }, { status: 400 });
  }

  let payload: UpdateTimeZoneInput;
  try {
    payload = updateTimeZoneSchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message ?? "Invalid payload." : "Invalid payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const updateData: Record<string, string | boolean | null> = {};
  if (payload.name !== undefined) updateData.name = payload.name.trim();
  if (payload.offset !== undefined) updateData.offset = payload.offset.trim();
  const hasOffsetDst = payload.offsetDst !== undefined;
  const observesDst = payload.observesDst;
  const hasObservesDst = observesDst !== undefined;

  if (hasOffsetDst) {
    const normalizedOffsetDst =
      payload.offsetDst === null ? null : payload.offsetDst?.trim();
    updateData.offsetDst = normalizedOffsetDst && normalizedOffsetDst.length > 0 ? normalizedOffsetDst : null;
    if (!hasObservesDst) {
      updateData.observesDst = Boolean(updateData.offsetDst);
    }
  }

  if (hasObservesDst) {
    updateData.observesDst = observesDst;
    if (!observesDst) {
      updateData.offsetDst = null;
    }
    if (observesDst && !hasOffsetDst) {
      return NextResponse.json(
        { error: "DST offset is required when daylight saving time is enabled." },
        { status: 400 }
      );
    }
  }

  if (updateData.observesDst === true && updateData.offsetDst === null) {
    return NextResponse.json(
      { error: "DST offset is required when daylight saving time is enabled." },
      { status: 400 }
    );
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
  }

  try {
    const result = await db
      .update(schema.timeZones)
      .set({ ...updateData, updatedAt: sql`now()` })
      .where(eq(schema.timeZones.id, timeZoneId))
      .returning({ id: schema.timeZones.id });

    if (!result.length) {
      return NextResponse.json({ error: "Time zone not found." }, { status: 404 });
    }
  } catch (error: any) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "Time zone already exists." }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to update time zone.";
    console.error("[time-zones:update] API error:", message);
    return NextResponse.json({ error: "Failed to update time zone." }, { status: 500 });
  }

  const refreshed = await fetchTimeZonesFromDb({
    page: 1,
    pageSize: 1,
    id: timeZoneId
  });

  const updatedTimeZone = refreshed.data.find(row => row.id === timeZoneId) ?? null;

  return NextResponse.json({ data: updatedTimeZone });
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

  const { id: timeZoneId } = await params;
  if (!timeZoneId) {
    return NextResponse.json({ error: "Time zone id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.timeZones.id })
    .from(schema.timeZones)
    .where(eq(schema.timeZones.id, timeZoneId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Time zone not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.timeZones).where(eq(schema.timeZones.id, timeZoneId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete time zone.";
    console.error("[time-zones:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete time zone." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: timeZoneId } });
}
