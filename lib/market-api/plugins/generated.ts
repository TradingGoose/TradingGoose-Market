import type { MarketPlugin } from "@/lib/market-api/plugins/types";

export interface InstalledMarketPluginEntry {
  moduleName: string;
  plugin: MarketPlugin;
}

export const installedMarketPlugins: readonly InstalledMarketPluginEntry[] = Object.freeze([]);
