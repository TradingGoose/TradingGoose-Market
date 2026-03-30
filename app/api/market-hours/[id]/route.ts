import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db, schema } from "@tradinggoose/db";
import { apiRequireEditor } from "@/lib/auth/session";

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

  const { id: marketHourId } = await params;
  if (!marketHourId) {
    return NextResponse.json({ error: "Market hour id is required." }, { status: 400 });
  }

  const existing = (await db
    .select({ id: schema.marketHours.id })
    .from(schema.marketHours)
    .where(eq(schema.marketHours.id, marketHourId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Market hour not found." }, { status: 404 });
  }

  try {
    await db.delete(schema.marketHours).where(eq(schema.marketHours.id, marketHourId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete market hour.";
    console.error("[market-hours:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete market hour." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: marketHourId } });
}
