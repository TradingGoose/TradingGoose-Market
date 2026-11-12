import { apiRequireSystemAdmin } from "@/lib/auth/session";
import { getMarketRouteDescriptorByTemplate } from "@/lib/market-api/core/manifest";
import {
  createManifestMethodPolicy,
  toExplicitHeadResponse,
} from "@/lib/market-api/core/method-guards";

export function createSystemAdminRoutePolicy(template: string) {
  const descriptor = getMarketRouteDescriptorByTemplate(template);
  if (descriptor.access !== "system-admin-session") {
    throw new Error(`Route ${template} is not owned by the system-admin session.`);
  }
  const methods = createManifestMethodPolicy(template);

  return Object.freeze({
    descriptor,
    authorize: (request: Request) => apiRequireSystemAdmin(request),
    reject: methods.reject,
    get: methods.GET,
    rejectHead: methods.HEAD,
    post: methods.POST,
    put: methods.PUT,
    patch: methods.PATCH,
    delete: methods.DELETE,
    options: methods.OPTIONS,
    head: async (
      request: Request,
      get: (request: Request) => Response | Promise<Response>,
    ) => toExplicitHeadResponse(get(request)),
  });
}
