import { NextResponse } from "next/server";
import {
  createManifestMethodPolicy,
  toExplicitHeadResponse,
} from "@/lib/market-api/core/method-guards";

export const runtime = "nodejs";
const methods = createManifestMethodPolicy("/api/health");

export async function GET(_request: Request) {
  const response = NextResponse.json({
    status: "ok",
    service: "tradinggoose-market",
    runtime: "nodejs",
  });
  response.headers.set("x-market-api", "next");
  return response;
}

export const HEAD = (request: Request) => toExplicitHeadResponse(GET(request));
export const POST = methods.POST;
export const PUT = methods.PUT;
export const PATCH = methods.PATCH;
export const DELETE = methods.DELETE;
export const OPTIONS = methods.OPTIONS;
