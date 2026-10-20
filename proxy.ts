import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { getMarketRuntimeConfig } from "@/lib/environment";

const PROTECTED_UI_PREFIXES = ["/account", "/admin"] as const;

function getCanonicalOrigin() {
  return getMarketRuntimeConfig().appUrl;
}

function isProtectedUiPath(pathname: string) {
  return PROTECTED_UI_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasCanonicalOrigin(request: NextRequest, canonicalOrigin: string) {
  // Next's proxy URL can contain its internal listening hostname and port.
  // Headers describe the public request only; the configured origin remains
  // the sole allowed origin and the sole source of redirect destinations.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const protocol = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.slice(0, -1);
  if ((protocol !== "http" && protocol !== "https") || /[\s,\\/#?@]/u.test(host)) return false;
  try {
    return new URL(`${protocol}://${host}`).origin === canonicalOrigin;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const canonicalOrigin = getCanonicalOrigin();
  if (
    !hasCanonicalOrigin(request, canonicalOrigin) &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    const canonicalUrl = new URL(canonicalOrigin);
    canonicalUrl.pathname = request.nextUrl.pathname;
    canonicalUrl.search = request.nextUrl.search;
    return NextResponse.redirect(canonicalUrl, 308);
  }

  if (isProtectedUiPath(request.nextUrl.pathname) && !getSessionCookie(request)) {
    const loginUrl = new URL("/login", canonicalOrigin);
    loginUrl.searchParams.set(
      "callbackUrl",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|health|files/serve|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
