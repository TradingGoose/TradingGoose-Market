import { NextResponse } from "next/server";

const SUPPORTED_VERSIONS = new Set(["v1"]);

async function getBodyVersion(request: Request): Promise<string | null> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return null;
  try {
    const body = (await request.clone().json()) as { version?: unknown } | null;
    return typeof body?.version === "string" ? body.version.trim() : null;
  } catch {
    return null;
  }
}

function normalizeVersion(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.trim().match(/^v?(\d+)/i);
  if (!match) return null;
  return `v${match[1]}`;
}

async function resolveVersion(request: Request): Promise<string | null> {
  const bodyValue = await getBodyVersion(request);
  const searchParams = new URL(request.url).searchParams;
  const queryValue = searchParams.get("version");
  return normalizeVersion(bodyValue ?? queryValue ?? null);
}

export async function requireApiVersion(request: Request): Promise<Response | null> {
  const version = await resolveVersion(request);
  if (!version) {
    const response = NextResponse.json({ error: "API version is required" }, { status: 400 });
    response.headers.set("x-market-api", "next");
    return response;
  }
  if (!SUPPORTED_VERSIONS.has(version)) {
    const response = NextResponse.json(
      { error: `Unsupported API version: ${version}` },
      { status: 400 }
    );
    response.headers.set("x-market-api", "next");
    return response;
  }
  return null;
}
