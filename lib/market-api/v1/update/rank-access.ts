import type { ApiContext } from "@/lib/market-api/core/context";
import type { PluginContext } from "@/lib/market-api/plugins/types";

export type RankUpdateAccessMode = "authenticated" | "service";

function resolveRankUpdateAccessMode(): RankUpdateAccessMode {
  const rawMode = process.env.MARKET_RANK_UPDATE_ACCESS_MODE?.trim().toLowerCase();

  if (!rawMode || rawMode === "authenticated") {
    return "authenticated";
  }

  if (rawMode === "service") {
    return "service";
  }

  throw new Error(
    `Invalid MARKET_RANK_UPDATE_ACCESS_MODE "${rawMode}". Expected "authenticated" or "service".`
  );
}

export function requireRankUpdateAccess(
  c: ApiContext,
  plugin?: PluginContext
): Response | null {
  if (!plugin) {
    return c.json({ error: "Plugin context is not available." }, 500);
  }

  const mode = resolveRankUpdateAccessMode();

  if (mode === "service" && !plugin.auth.isServiceKey) {
    return c.json({ error: "This rank update route requires the internal service key." }, 403);
  }

  if (mode === "authenticated" && plugin.auth.isFreeTier) {
    return c.json({ error: "This rank update route requires an authenticated API key." }, 401);
  }

  return null;
}
