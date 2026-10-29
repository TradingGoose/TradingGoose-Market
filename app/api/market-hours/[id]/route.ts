import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

import { createSystemAdminRoutePolicy } from "@/lib/market-api/core/entity-route";


const routePolicy = createSystemAdminRoutePolicy("/api/market-hours/[id]");

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const auth = await routePolicy.authorize(_request);
  if (auth.error) return auth.error;


  const { id: marketHourId } = await params;
  if (!marketHourId) {
    return NextResponse.json({ error: "Market hour id is required." }, { status: 400 });
  }

  const existing = (await requireDatabase()
    .select({ id: schema.marketHours.id })
    .from(schema.marketHours)
    .where(eq(schema.marketHours.id, marketHourId))
    .limit(1)) as { id: string }[];

  if (!existing.length) {
    return NextResponse.json({ error: "Market hour not found." }, { status: 404 });
  }

  try {
    await requireDatabase().delete(schema.marketHours).where(eq(schema.marketHours.id, marketHourId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete market hour.";
    console.error("[market-hours:delete] API error:", message);
    return NextResponse.json({ error: "Failed to delete market hour." }, { status: 500 });
  }

  return NextResponse.json({ data: { id: marketHourId } });
}

export const OPTIONS = routePolicy.options;
export const GET = routePolicy.get;
export const HEAD = routePolicy.rejectHead;
export const POST = routePolicy.post;
export const PUT = routePolicy.put;
export const PATCH = routePolicy.patch;
