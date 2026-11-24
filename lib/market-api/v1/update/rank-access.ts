import type { MarketApiActor } from "@/lib/market-api/core/access";
import type { ApiContext } from "@/lib/market-api/core/context";

export function privateRankTransaction(
  context: ApiContext,
  actor: MarketApiActor | null,
) {
  if (actor?.keyClass === "private") {
    if (!context.tx) throw new Error("Private rank mutation requires its authorized transaction");
    return context.tx;
  }
  return context.json({ error: "A private Market API key is required." }, 403);
}
