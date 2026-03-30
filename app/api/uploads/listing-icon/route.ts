import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import mime from "mime";

import { db, schema } from "@tradinggoose/db";
import { deleteFile, extractStorageKey, uploadFileWithKey } from "@uploads/core/storage-client";
import { apiRequireEditor } from "@/lib/auth/session";

const MAX_SIZE_BYTES = 512 * 1024; // 512 KB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];
const CLEANUP_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await apiRequireEditor();
  if (auth.error) return auth.error;

  if (!db) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;
  const listingId = (form.get("listing_id") as string | null)?.trim();

  if (!listingId || !file) {
    return NextResponse.json({ error: "listing_id and file are required." }, { status: 400 });
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "File too large (max 512KB)." }, { status: 413 });
  }

  const contentType = file.type || "application/octet-stream";
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  }

  const [listing] = (await db
    .select({
      id: schema.listings.id,
      iconUrl: schema.listings.iconUrl
    })
    .from(schema.listings)
    .where(sql`${schema.listings.id} = ${listingId}`)
    .limit(1)) as { id: string; iconUrl: string | null }[];

  if (!listing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }

  const extFromMime = (mime.getExtension(contentType) || "png").toLowerCase();
  const keyBase = `icons/listings/${listing.id}`;
  const key = `${keyBase}.${extFromMime}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFileWithKey(buffer, key, contentType, buffer.length);

  // delete previous icon if it points to a different key
  const prevInfo = extractStorageKey(listing.iconUrl);
  if (prevInfo && prevInfo.key !== uploaded.key) {
    try {
      await deleteFile(prevInfo.key, prevInfo.provider);
    } catch {
      // ignore cleanup errors
    }
  }

  const extensionsToCleanup = CLEANUP_EXTENSIONS.filter((ext) => ext !== extFromMime);
  await Promise.all(
    extensionsToCleanup.map(async (ext) => {
      try {
        await deleteFile(`${keyBase}.${ext}`);
      } catch {
        // ignore cleanup errors
      }
    })
  );

  // persist iconUrl on listing
  await db
    .update(schema.listings)
    .set({
      iconUrl: uploaded.path,
      logoMissing: false,
      logoCheckedAt: sql`now()`,
      updatedAt: sql`now()`
    })
    .where(sql`${schema.listings.id} = ${listingId}`);

  return NextResponse.json({ data: { url: uploaded.path, key: uploaded.key } });
}
