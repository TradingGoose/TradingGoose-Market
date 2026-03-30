import mime from "mime";

import { downloadFile } from "./storage-client";

const SERVE_PREFIXES = ["/api/files/serve/", "/files/serve/"];

export function resolveServeKeyFromPath(pathname: string): string | null {
  for (const prefix of SERVE_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      const key = pathname.slice(prefix.length).replace(/^\/+/, "");
      return key || null;
    }
  }
  return null;
}

export function resolveServeKeyFromParts(parts: string[] | string): string | null {
  const list = Array.isArray(parts) ? parts : [parts];
  if (!list.length) return null;
  let key = list.map((part) => String(part)).join("/").replace(/^\/+/, "");
  if (!key) return null;
  if (key.startsWith("blob/")) key = key.slice("blob/".length);
  if (key.startsWith("vercel/")) key = key.slice("vercel/".length);
  return key || null;
}

export async function buildServePayload(key: string): Promise<{
  body: ArrayBuffer;
  contentType: string;
  contentLength: number;
}> {
  const buffer = await downloadFile(key);
  const body = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  const contentType =
    mime.getType(key) ||
    (key.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "application/octet-stream");
  return { body, contentType, contentLength: buffer.byteLength };
}
