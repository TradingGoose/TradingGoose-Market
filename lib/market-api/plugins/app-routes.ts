import { createRoutePluginContext } from "@/lib/market-api/plugins/context";
import { getEntityEnrichers, runEntityEnrichers } from "@/lib/market-api/plugins/runtime";
import type { EntityKind } from "@/lib/market-api/plugins/types";

export async function runAppRouteAdminReadEnrichers<T>(
  request: Request,
  kind: EntityKind,
  rows: T[],
  userId?: string | null
) {
  if (!rows.length) return rows;
  const enrichers = await getEntityEnrichers(kind, "admin-read");
  if (!enrichers.length) return rows;
  const plugin = createRoutePluginContext(request, { userId });
  return runEntityEnrichers(plugin, kind, "admin-read", rows);
}

export async function runAppRouteAfterWriteEnricher<T>(
  request: Request,
  kind: EntityKind,
  row: T | null,
  userId?: string | null
) {
  if (!row) return row;
  const enrichers = await getEntityEnrichers(kind, "after-write");
  if (!enrichers.length) return row;
  const plugin = createRoutePluginContext(request, { userId });
  const [enriched] = await runEntityEnrichers(plugin, kind, "after-write", [row]);
  return enriched ?? row;
}
