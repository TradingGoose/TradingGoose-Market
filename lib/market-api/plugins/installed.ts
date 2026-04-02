import "server-only";

import {
  installedMarketPlugins as generatedInstalledMarketPlugins,
  type InstalledMarketPluginEntry,
} from "@/lib/market-api/plugins/generated";
import type { MarketPlugin } from "@/lib/market-api/plugins/types";

let installedMarketPluginsPromise: Promise<readonly MarketPlugin[]> | null = null;

function validateMarketPlugin(entry: InstalledMarketPluginEntry): MarketPlugin {
  const { moduleName, plugin } = entry;
  if (!plugin.name) {
    throw new Error(`Plugin module "${moduleName}" must export a plugin with a non-empty name.`);
  }

  return plugin;
}

async function loadInstalledMarketPlugins(): Promise<readonly MarketPlugin[]> {
  return Object.freeze(generatedInstalledMarketPlugins.map(validateMarketPlugin));
}

export function getInstalledMarketPlugins(): Promise<readonly MarketPlugin[]> {
  installedMarketPluginsPromise ??= loadInstalledMarketPlugins();
  return installedMarketPluginsPromise;
}
