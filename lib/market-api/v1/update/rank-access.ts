import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

export function requirePrivateRankActor(
  context: ApiContext,
  actor: MarketApiActor | null,
): Response | null {
  if (actor?.keyClass === "private") return null;
  return context.json({ error: "A private Market API key is required." }, 403);
}
