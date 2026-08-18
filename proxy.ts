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

export function proxy(request: NextRequest) {
  const canonicalOrigin = getCanonicalOrigin();
  if (
    canonicalOrigin !== request.nextUrl.origin &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return NextResponse.redirect(
      new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, canonicalOrigin),
      308,
    );
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
