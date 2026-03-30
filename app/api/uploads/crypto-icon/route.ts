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
  const cryptoId = (form.get("cryptoId") as string | null)?.trim();

  if (!cryptoId || !file) {
    return NextResponse.json({ error: "cryptoId and file are required." }, { status: 400 });
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 512KB)." }, { status: 413 });
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  }

  const [crypto] = (await db
    .select({
      id: schema.cryptos.id,
      iconUrl: schema.cryptos.iconUrl
    })
    .from(schema.cryptos)
    .where(sql`${schema.cryptos.id} = ${cryptoId}`)
    .limit(1)) as { id: string; iconUrl: string | null }[];

  if (!crypto) {
    return NextResponse.json({ error: "Crypto not found." }, { status: 404 });
  }

  const extFromMime = mime.getExtension(contentType) || "png";
  const key = `icons/cryptos/${crypto.id}.${extFromMime}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFileWithKey(buffer, key, contentType, buffer.length);

  const prevInfo = extractStorageKey(crypto.iconUrl);
  if (prevInfo && prevInfo.key !== uploaded.key) {
    try {
      await deleteFile(prevInfo.key, prevInfo.provider);
    } catch {
      // ignore cleanup errors
    }
  }

  await db
    .update(schema.cryptos)
    .set({
      iconUrl: uploaded.path,
      logoMissing: false,
      logoCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    })
    .where(sql`${schema.cryptos.id} = ${cryptoId}`);

  return NextResponse.json({ data: { url: uploaded.path, key: uploaded.key } });
}
