import type { MarketPlugin } from "@/lib/market-api/plugins/types";

export interface InstalledMarketPluginEntry {
  moduleName: string;
  plugin: MarketPlugin;
}

import pluginModule0 from "./vendor/@tradinggoose/market-plugin-logo/index.js";

const normalizedPluginModule0: readonly InstalledMarketPluginEntry[] = Object.freeze((Array.isArray(pluginModule0) ? pluginModule0 : [pluginModule0]).map((plugin) => ({ moduleName: "@tradinggoose/market-plugin-logo", plugin } satisfies InstalledMarketPluginEntry)));

export const installedMarketPlugins: readonly InstalledMarketPluginEntry[] = Object.freeze([
  ...normalizedPluginModule0,
]);
