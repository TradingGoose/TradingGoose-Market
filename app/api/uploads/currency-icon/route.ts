import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import mime from "mime";

import { db, schema } from "@tradinggoose/db";
import { deleteFile, extractStorageKey, uploadFileWithKey } from "@uploads/core/storage-client";
import { apiRequireEditor } from "@/lib/auth/session";

const MAX_SIZE_BYTES = 512 * 1024; // 512 KB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const currencyId = (form.get("currencyId") as string | null)?.trim();

  if (!currencyId || !file) {
    return NextResponse.json({ error: "currencyId and file are required." }, { status: 400 });
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 512KB)." }, { status: 413 });
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  }

  const [currency] = (await db
    .select({
      id: schema.currencies.id,
      iconUrl: schema.currencies.iconUrl
    })
    .from(schema.currencies)
    .where(sql`${schema.currencies.id} = ${currencyId}`)
    .limit(1)) as { id: string; iconUrl: string | null }[];

  if (!currency) {
    return NextResponse.json({ error: "Currency not found." }, { status: 404 });
  }

  const extFromMime = mime.getExtension(contentType) || "png";
  const key = `icons/currencies/${currency.id}.${extFromMime}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFileWithKey(buffer, key, contentType, buffer.length);

  const prevInfo = extractStorageKey(currency.iconUrl);
  if (prevInfo && prevInfo.key !== uploaded.key) {
    try {
      await deleteFile(prevInfo.key, prevInfo.provider);
    } catch {
      // ignore cleanup errors
    }
  }

  await db
    .update(schema.currencies)
    .set({ iconUrl: uploaded.path, updatedAt: sql`now()` })
    .where(sql`${schema.currencies.id} = ${currencyId}`);

  return NextResponse.json({ data: { url: uploaded.path, key: uploaded.key } });
}
