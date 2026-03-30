import { getServePathPrefix } from "@uploads/core/storage-client";

const ABSOLUTE_URL = /^https?:\/\//i;

function joinOrigin(origin: string, path: string) {
  if (!path) return origin;
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function resolveIconUrl(request: Request, iconUrl: string | null) {
  if (!iconUrl) return null;
  const trimmed = iconUrl.trim();
  if (!trimmed) return null;
  if (ABSOLUTE_URL.test(trimmed)) return trimmed;

  const origin = new URL(request.url).origin;
  if (trimmed.startsWith("/")) {
    return joinOrigin(origin, trimmed);
  }

  const normalized = trimmed.replace(/^\/+/, "");
  const servePrefix = getServePathPrefix();
  const normalizedPrefix = servePrefix.replace(/^\/+/, "");

  if (normalized.startsWith(normalizedPrefix)) {
    return joinOrigin(origin, normalized);
  }

  const prefix = servePrefix.endsWith("/") ? servePrefix : `${servePrefix}/`;
  return joinOrigin(origin, `${prefix}${normalized}`);
}

export function runInBackground(task: Promise<unknown>, errorPrefix: string) {
  void task.catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${errorPrefix}:`, message);
  });
}
