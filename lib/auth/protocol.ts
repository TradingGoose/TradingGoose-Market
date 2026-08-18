import {
  MARKET_API_ROUTE_MANIFEST,
  isMarketApiMethod,
  resolveMarketRouteDescriptor,
} from "@/lib/market-api/core/manifest";
import {
  marketMethodNotAllowed,
  marketRouteNotFound,
} from "@/lib/market-api/core/method-guards";
import { requireSameOriginBrowserMutation } from "@/lib/market-api/core/browser-route";

export const AUTH_PROTOCOL_ROUTES = Object.freeze(
  MARKET_API_ROUTE_MANIFEST.filter((descriptor) => descriptor.surface === "auth").map(
    (descriptor) => ({ method: descriptor.methods[0], path: descriptor.path }),
  ),
);

function isResetCallbackPath(pathname: string): boolean {
  const prefix = "/api/auth/reset-password/";
  if (!pathname.startsWith(prefix)) return false;
  const encodedToken = pathname.slice(prefix.length);
  if (!encodedToken || encodedToken.includes("/")) return false;

  try {
    const token = decodeURIComponent(encodedToken);
    return token.length > 0 && !token.includes("/");
  } catch {
    return false;
  }
}

function isJsonRequest(request: Request): boolean {
  const raw = request.headers.get("content-type");
  if (!raw) return false;
  const [mediaType, ...parameters] = raw.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json") return false;
  return parameters.every((part) => {
    const parameter = part.trim();
    return /^[!#$%&'*+.^_`|~0-9a-z-]+\s*=\s*(?:[!#$%&'*+.^_`|~0-9a-z-]+|"[^"\r\n]*")$/i.test(parameter);
  });
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(record, key));
}

async function readJsonObject(request: Request, error: string): Promise<Record<string, unknown> | Response> {
  if (!isJsonRequest(request)) return response(400, error);
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return response(400, error);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, error);
  return body as Record<string, unknown>;
}

function reconstructedJsonRequest(request: Request, body: Record<string, unknown>): Request {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  return new Request(request, { headers, body: JSON.stringify(body) });
}

async function validateSignupRequest(request: Request): Promise<Request | Response> {
  const body = await readJsonObject(request, "INVALID_SIGNUP_REQUEST");
  if (body instanceof Response) return body;
  if (
    !hasExactKeys(body, ["name", "email", "password"]) ||
    typeof body.name !== "string" ||
    body.name.trim().length === 0 ||
    typeof body.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    typeof body.password !== "string" ||
    body.password.length === 0
  ) {
    return response(400, "INVALID_SIGNUP_REQUEST");
  }
  return reconstructedJsonRequest(request, {
    name: body.name.trim(),
    email: body.email,
    password: body.password,
  });
}

async function validateOtpSendRequest(request: Request): Promise<Request | Response> {
  const body = await readJsonObject(request, "INVALID_OTP_REQUEST");
  if (body instanceof Response) return body;
  if (
    !hasExactKeys(body, ["email", "type"]) ||
    typeof body.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    body.type !== "sign-in"
  ) {
    return response(400, "INVALID_OTP_REQUEST");
  }
  return reconstructedJsonRequest(request, { email: body.email, type: "sign-in" });
}

async function validateOtpSignInRequest(request: Request): Promise<Request | Response> {
  const body = await readJsonObject(request, "INVALID_OTP_REQUEST");
  if (body instanceof Response) return body;
  if (
    !hasExactKeys(body, ["email", "otp"]) ||
    typeof body.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
    typeof body.otp !== "string" ||
    !/^\d{6}$/.test(body.otp)
  ) {
    return response(400, "INVALID_OTP_REQUEST");
  }
  return reconstructedJsonRequest(request, { email: body.email, otp: body.otp });
}

function response(status: number, error: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  return new Response(JSON.stringify({ error }), { status, headers });
}

async function validateDisplayNameRequest(request: Request): Promise<Request | Response> {
  const record = await readJsonObject(request, "INVALID_PROFILE_UPDATE");
  if (record instanceof Response) return record;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.name !== "string" ||
    record.name.trim().length === 0
  ) {
    return response(400, "INVALID_PROFILE_UPDATE");
  }

  return reconstructedJsonRequest(request, { name: record.name.trim() });
}

export async function dispatchAuthProtocolRequest(
  request: Request,
  handler: (request: Request) => Promise<Response>
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  const descriptor = resolveMarketRouteDescriptor(pathname);

  if (
    !descriptor ||
    descriptor.surface !== "auth" ||
    (descriptor.id === "auth.reset-password.token" && !isResetCallbackPath(pathname))
  ) {
    return marketRouteNotFound(request.method);
  }

  if (
    !isMarketApiMethod(request.method) ||
    !descriptor.methods.includes(request.method)
  ) {
    return marketMethodNotAllowed(descriptor, request.method);
  }

  const originError = requireSameOriginBrowserMutation(request);
  if (originError) return originError;

  if (pathname === "/api/auth/sign-up/email") {
    const validated = await validateSignupRequest(request);
    if (validated instanceof Response) return validated;
    return handler(validated);
  }

  if (pathname === "/api/auth/email-otp/send-verification-otp") {
    const validated = await validateOtpSendRequest(request);
    if (validated instanceof Response) return validated;
    return handler(validated);
  }

  if (pathname === "/api/auth/sign-in/email-otp") {
    const validated = await validateOtpSignInRequest(request);
    if (validated instanceof Response) return validated;
    return handler(validated);
  }

  if (pathname === "/api/auth/update-user") {
    const validated = await validateDisplayNameRequest(request);
    if (validated instanceof Response) return validated;
    return handler(validated);
  }

  return handler(request);
}
