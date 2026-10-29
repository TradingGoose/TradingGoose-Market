import { getMarketRuntimeConfig } from "@/lib/environment";
import { createUnkeyAdapter } from "./client";

let cachedSignature: string | null = null;
let cachedAdapter: ReturnType<typeof createUnkeyAdapter> | null = null;

export function getMarketKeyProvider() {
  const config = getMarketRuntimeConfig().unkey;
  const signature = [config.apiId, config.rootKey].join("\u0000");
  if (!cachedAdapter || cachedSignature !== signature) {
    cachedSignature = signature;
    cachedAdapter = createUnkeyAdapter(config);
  }
  return cachedAdapter;
}
