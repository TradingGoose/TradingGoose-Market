import { randomUUID } from "node:crypto";
import { schema } from "@tradinggoose/db";
import { requireDatabase } from "@/lib/db/runtime";

import { eq } from "drizzle-orm";

import { apiRequireCustomerSession } from "@/lib/auth/session";
import {
  browserRouteDescriptor,
  rejectBrowserHead,
  rejectBrowserMethod,
  rejectBrowserOptions,
} from "@/lib/market-api/core/browser-route";
import {
  deleteFile,
  extractStorageKey,
  uploadFileWithKey,
} from "@uploads/core/storage-client";


const TEMPLATE = "/api/account/profile/image";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_PROFILE_IMAGE_REQUEST_BYTES =
  MAX_PROFILE_IMAGE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
browserRouteDescriptor(TEMPLATE, "POST");
browserRouteDescriptor(TEMPLATE, "DELETE");

function imageKind(bytes: Uint8Array): { mime: "image/png" | "image/jpeg"; extension: "png" | "jpg" } | null {
  const png = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (png) return { mime: "image/png", extension: "png" };
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return jpeg ? { mime: "image/jpeg", extension: "jpg" } : null;
}

async function cancelRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // The response still rejects the request when the transport cannot be cancelled.
  }
}

async function readBoundedMultipartForm(request: Request): Promise<FormData | null> {
  const body = request.body;
  if (!body) return null;

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const normalizedLength = contentLength.trim();
    if (
      !/^\d+$/.test(normalizedLength) ||
      BigInt(normalizedLength) > BigInt(MAX_PROFILE_IMAGE_REQUEST_BYTES)
    ) {
      await cancelRequestBody(request);
      return null;
    }
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROFILE_IMAGE_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return null;
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const contentType = request.headers.get("content-type");
  if (!contentType) return null;
  try {
    return await new Response(bytes.buffer, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return null;
  }
}

async function replaceProfileImage(
  userId: string,
  nextImage: string | null,
): Promise<string | null> {
  return requireDatabase().transaction(async (tx) => {
    const [current] = await tx
      .select({ image: schema.user.image })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .for("update")
      .limit(1);
    if (!current) throw new Error("Profile owner is missing.");

    const updated = await tx
      .update(schema.user)
      .set({ image: nextImage, updatedAt: new Date() })
      .where(eq(schema.user.id, userId))
      .returning({ id: schema.user.id });
    if (updated.length !== 1) {
      throw new Error("Profile image update was not committed.");
    }
    return current.image ?? null;
  });
}

async function cleanupOwnedImage(userId: string, path: string | null): Promise<void> {
  const target = extractStorageKey(path);
  if (!target || !target.key.startsWith(`profile-pictures/${userId}/`)) return;
  try {
    await deleteFile(target.key, target.provider);
  } catch (error) {
    console.warn("Profile image cleanup failed.", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function POST(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;

  const form = await readBoundedMultipartForm(request);
  if (!form) {
    return Response.json({ error: "INVALID_PROFILE_IMAGE" }, { status: 400 });
  }
  const entries: Array<[string, FormDataEntryValue]> = [];
  form.forEach((value, key) => entries.push([key, value]));
  const entry = entries[0];
  if (
    entries.length !== 1 ||
    !entry ||
    entry[0] !== "file" ||
    typeof entry[1] === "string"
  ) {
    return Response.json({ error: "INVALID_PROFILE_IMAGE" }, { status: 400 });
  }

  const file = entry[1];
  if (
    file.size === 0 ||
    file.size > MAX_PROFILE_IMAGE_BYTES ||
    (file.type !== "image/png" && file.type !== "image/jpeg")
  ) {
    return Response.json({ error: "INVALID_PROFILE_IMAGE" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = imageKind(bytes);
  if (!kind || kind.mime !== file.type) {
    return Response.json({ error: "INVALID_PROFILE_IMAGE" }, { status: 400 });
  }

  const key = `profile-pictures/${guard.user.id}/${randomUUID()}.${kind.extension}`;
  let uploaded: Awaited<ReturnType<typeof uploadFileWithKey>>;
  try {
    uploaded = await uploadFileWithKey(Buffer.from(bytes), key, kind.mime, file.size);
  } catch (error) {
    console.error("Profile image upload failed.", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "PROFILE_IMAGE_UNAVAILABLE" }, { status: 503 });
  }

  let oldImage: string | null;
  try {
    oldImage = await replaceProfileImage(guard.user.id, uploaded.path);
  } catch (error) {
    await cleanupOwnedImage(guard.user.id, uploaded.path);
    console.error("Profile image persistence failed.", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "PROFILE_IMAGE_UNAVAILABLE" }, { status: 503 });
  }

  await cleanupOwnedImage(guard.user.id, oldImage);
  return Response.json({ image: uploaded.path });
}

export async function DELETE(request: Request) {
  const guard = await apiRequireCustomerSession(request);
  if (guard.error) return guard.error;

  const contentLength = request.headers.get("content-length")?.trim();
  if (
    request.body !== null ||
    (contentLength !== undefined && contentLength !== "0") ||
    request.headers.has("transfer-encoding")
  ) {
    await cancelRequestBody(request);
    return Response.json({ error: "INVALID_PROFILE_IMAGE_DELETE" }, { status: 400 });
  }

  let oldImage: string | null;
  try {
    oldImage = await replaceProfileImage(guard.user.id, null);
  } catch (error) {
    console.error("Profile image removal failed.", {
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "PROFILE_IMAGE_UNAVAILABLE" }, { status: 503 });
  }

  await cleanupOwnedImage(guard.user.id, oldImage);
  return Response.json({ image: null });
}

export const GET = () => rejectBrowserMethod(TEMPLATE, "GET");
export const HEAD = () => rejectBrowserHead(TEMPLATE);
export const OPTIONS = () => rejectBrowserOptions(TEMPLATE);
export const PUT = () => rejectBrowserMethod(TEMPLATE, "PUT");
export const PATCH = () => rejectBrowserMethod(TEMPLATE, "PATCH");
