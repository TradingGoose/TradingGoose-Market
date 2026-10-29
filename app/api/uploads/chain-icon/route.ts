import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import mime from "mime";

import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

import { deleteFile, extractStorageKey, uploadFileWithKey } from "@uploads/core/storage-client";
import { createSystemAdminRoutePolicy } from "@/lib/market-api/core/entity-route";


const MAX_SIZE_BYTES = 512 * 1024; // 512 KB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

export const runtime = "nodejs";
const routePolicy = createSystemAdminRoutePolicy("/api/uploads/chain-icon");

export async function POST(request: Request) {
  const auth = await routePolicy.authorize(request);
  if (auth.error) return auth.error;


  const form = await request.formData();
  const file = form.get("file") as File | null;
  const chainId = (form.get("chainId") as string | null)?.trim();

  if (!chainId || !file) {
    return NextResponse.json({ error: "chainId and file are required." }, { status: 400 });
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 512KB)." }, { status: 413 });
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  }

  const [chain] = (await requireDatabase()
    .select({
      id: schema.chains.id,
      iconUrl: schema.chains.iconUrl
    })
    .from(schema.chains)
    .where(sql`${schema.chains.id} = ${chainId}`)
    .limit(1)) as { id: string; iconUrl: string | null }[];

  if (!chain) {
    return NextResponse.json({ error: "Chain not found." }, { status: 404 });
  }

  const extFromMime = mime.getExtension(contentType) || "png";
  const key = `icons/chains/${chain.id}.${extFromMime}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFileWithKey(buffer, key, contentType, buffer.length);

  const prevInfo = extractStorageKey(chain.iconUrl);
  if (prevInfo && prevInfo.key !== uploaded.key) {
    try {
      await deleteFile(prevInfo.key, prevInfo.provider);
    } catch {
      // ignore cleanup errors
    }
  }

  await requireDatabase()
    .update(schema.chains)
    .set({ iconUrl: uploaded.path, updatedAt: sql`now()` })
    .where(sql`${schema.chains.id} = ${chainId}`);

  return NextResponse.json({ data: { url: uploaded.path, key: uploaded.key } });
}

export const OPTIONS = routePolicy.options;
export const GET = routePolicy.get;
export const HEAD = routePolicy.rejectHead;
export const PUT = routePolicy.put;
export const PATCH = routePolicy.patch;
export const DELETE = routePolicy.delete;
