import {
  getMarketRouteDescriptorByTemplate,
  type MarketApiMethod,
} from "./manifest";
import { getMarketRuntimeConfig } from "@/lib/environment";
import { marketMethodNotAllowed } from "./method-guards";

const UNSAFE_BROWSER_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

export function requireSameOriginBrowserMutation(request: Request): Response | null {
  if (!UNSAFE_BROWSER_METHODS.has(request.method.toUpperCase())) return null;

  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    origin !== getMarketRuntimeConfig().appUrl ||
    (fetchSite !== null && fetchSite !== "same-origin")
  ) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  return null;
}

export function browserRouteDescriptor(template: string, method: MarketApiMethod) {
  const descriptor = getMarketRouteDescriptorByTemplate(template);
  if (!descriptor.methods.includes(method)) {
    throw new Error(`${template} does not own ${method}`);
  }
  return descriptor;
}

export function rejectBrowserHead(template: string) {
  return rejectBrowserMethod(template, "HEAD");
}

export function rejectBrowserOptions(template: string) {
  return rejectBrowserMethod(template, "OPTIONS");
}

export function rejectBrowserMethod(template: string, method: MarketApiMethod) {
  return marketMethodNotAllowed(getMarketRouteDescriptorByTemplate(template), method);
}
