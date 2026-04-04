import type { AuthContext } from "@/lib/market-api/core/auth";
import type { PluginContext } from "@/lib/market-api/plugins/types";

import { db } from "@tradinggoose/db";

function requireDb(): NonNullable<typeof db> {
  if (!db) {
    throw new Error("Database connection is not available.");
  }
  return db;
}

export function createPluginContext(request: Request, auth: AuthContext): PluginContext {
  return {
    request,
    db,
    auth,
    env: process.env as Record<string, string | undefined>,
    fetch,
    log: console,
    requireDb
  };
}

export function createRoutePluginContext(
  request: Request,
  options?: { userId?: string | null; isServiceKey?: boolean; rateLimitKey?: string }
): PluginContext {
  const userId = options?.userId ?? undefined;
  return createPluginContext(request, {
    userId,
    isServiceKey: options?.isServiceKey ?? false,
    isFreeTier: false,
    rateLimitKey: options?.rateLimitKey ?? (userId ? `app-route:${userId}` : "app-route")
  });
}

export function withPluginContextRequest(context: PluginContext, request: Request): PluginContext {
  return {
    ...context,
    request
  };
}
