import { NextResponse } from "next/server";

import { db } from "@tradinggoose/db";
import { fetchCitiesForExport } from "../lib";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!db) {
      return NextResponse.json(
        { error: "Database connection is not configured." },
        { status: 503 }
      );
    }

    const data = await fetchCitiesForExport();
    const body = JSON.stringify(data, null, 2);
    const filename = `cities-export-${new Date().toISOString().split("T")[0]}.json`;

    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cities:export] API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
