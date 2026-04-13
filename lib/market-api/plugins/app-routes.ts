import { createRoutePluginContext } from "@/lib/market-api/plugins/context";
import { triggerEntityEnrichersInBackground } from "@/lib/market-api/plugins/runtime";
import type { EntityKind } from "@/lib/market-api/plugins/types";

export async function runAppRouteAdminReadEnrichers<T>(
  request: Request,
  kind: EntityKind,
  rows: T[],
  userId?: string | null
) {
  if (!rows.length) return rows;
  const plugin = createRoutePluginContext(request, { userId });
  triggerEntityEnrichersInBackground(plugin, kind, "admin-read", rows);
  return rows;
}

export async function runAppRouteAfterWriteEnricher<T>(
  request: Request,
  kind: EntityKind,
  row: T | null,
  userId?: string | null
) {
  if (!row) return row;
  const plugin = createRoutePluginContext(request, { userId });
  triggerEntityEnrichersInBackground(plugin, kind, "after-write", [row]);
  return row;
}
