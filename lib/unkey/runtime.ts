import { getMarketRuntimeConfig } from "@/lib/environment";
import { createUnkeyAdapter } from "./client";

let cachedSignature: string | null = null;
let cachedAdapter: ReturnType<typeof createUnkeyAdapter> | null = null;

export function getMarketKeyProvider() {
  const config = getMarketRuntimeConfig().unkey;
  const signature = [
    config.apiId,
    config.managementRootKey,
    config.verifyRootKey,
  ].join("\u0000");
  if (!cachedAdapter || cachedSignature !== signature) {
    cachedSignature = signature;
    cachedAdapter = createUnkeyAdapter({
      apiId: config.apiId,
      managementRootKey: config.managementRootKey,
      verifyRootKey: config.verifyRootKey,
    });
  }
  return cachedAdapter;
}
