import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const SEARCH_PREFIX = "/api/search";
const UPDATE_PREFIX = "/api/update";
const GET_PREFIX = "/api/get";
const AUTH_PREFIX = "/api/auth";
const FILES_PREFIX = "/api/files/serve";
const PUBLIC_FILES_PREFIX = "/files/serve";
const HEALTH_PATH = "/api/health";
const ADMIN_PREFIX = "/admin";

function parseOrigins(raw?: string | null) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRequestHost(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = (forwardedHost ?? request.headers.get("host")) ?? "";
  const host = hostHeader.split(",")[0]?.trim() ?? "";
  return host;
}

function isLocalHost(host: string) {
  const hostname = host.split(":")[0];
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function resolveAllowedOrigins(request: NextRequest) {
  const allowed = new Set<string>();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    allowed.add(appUrl);
  }

  const host = getRequestHost(request);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const protocol =
    forwardedProto?.split(",")[0]?.trim() ??
    request.nextUrl.protocol.replace(":", "");

  if (host && protocol) {
    allowed.add(`${protocol}://${host}`);
  }

  return allowed;
}

function buildCorsHeaders(request: NextRequest, origin: string) {
  const requestHeaders = request.headers.get("access-control-request-headers");
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": requestHeaders ?? "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function applyCors(
  response: NextResponse,
  request: NextRequest,
  origin: string | null,
  allowedOrigins: Set<string>
) {
  if (!origin || !allowedOrigins.has(origin)) return response;
  const headers = buildCorsHeaders(request, origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

function isPublicAsset(pathname: string) {
  if (pathname.startsWith("/_next")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return true;
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

export default function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowedOrigins = resolveAllowedOrigins(request);
  const isAllowedOrigin = !!origin && allowedOrigins.has(origin);
  const pathname = request.nextUrl.pathname;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const isSearchOrUpdate =
    pathname === SEARCH_PREFIX ||
    pathname.startsWith(`${SEARCH_PREFIX}/`) ||
    pathname === UPDATE_PREFIX ||
    pathname.startsWith(`${UPDATE_PREFIX}/`) ||
    pathname === GET_PREFIX ||
    pathname.startsWith(`${GET_PREFIX}/`);
  const isAuthApi = pathname === AUTH_PREFIX || pathname.startsWith(`${AUTH_PREFIX}/`);
  const isFilesServe =
    pathname === FILES_PREFIX ||
    pathname.startsWith(`${FILES_PREFIX}/`) ||
    pathname === PUBLIC_FILES_PREFIX ||
    pathname.startsWith(`${PUBLIC_FILES_PREFIX}/`);
  const isHealth = pathname === HEALTH_PATH;
  const isAdminRoute = pathname === ADMIN_PREFIX || pathname.startsWith(`${ADMIN_PREFIX}/`);
  const isPublicPage = !isApi && !isAdminRoute;
  const isPublic =
    isPublicAsset(pathname) || isAuthApi || isFilesServe || isHealth || isPublicPage;

  if (request.method === "OPTIONS" && isApi) {
    if (!isAllowedOrigin || !origin) {
      return new NextResponse(null, { status: 204 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(request, origin)
    });
  }

  const hasActiveSession = Boolean(getSessionCookie(request));
  const allowLocalBypass =
    !process.env.BETTER_AUTH_SECRET &&
    process.env.NODE_ENV !== "production" &&
    isLocalHost(getRequestHost(request));

  if (!allowLocalBypass && !hasActiveSession && !isSearchOrUpdate && !isPublic) {
    if (isApi) {
      const response = NextResponse.json(
        { error: "TradingGoose-Market authentication is required." },
        { status: 401 }
      );
      return applyCors(response, request, origin, allowedOrigins);
    }

    if (isAdminRoute) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl);
    }

    return new NextResponse("Not Found", { status: 404 });
  }

  const response = NextResponse.next();
  if (!isApi) return response;
  return applyCors(response, request, origin, allowedOrigins);
}

export const config = {
  matcher: "/:path*"
};
