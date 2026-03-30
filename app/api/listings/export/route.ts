import { NextResponse } from "next/server";

import { db } from "@tradinggoose/db";
import { fetchListingsForExport } from "../lib";

export const runtime = "nodejs";

export async function GET() {
  try {
    if (!db) {
      return NextResponse.json(
        { error: "Database connection is not configured." },
        { status: 503 }
      );
    }

    const data = await fetchListingsForExport();
    const body = JSON.stringify(data, null, 2);
    const filename = `listings-export-${new Date().toISOString().split("T")[0]}.json`;

    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[listings:export] API error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
