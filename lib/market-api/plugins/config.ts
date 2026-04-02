export const MARKET_PLUGIN_MODULES_ENV = "MARKET_PLUGIN_MODULES";

export function parseMarketPluginModules(value: string | undefined): string[] {
  if (!value) return [];

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getConfiguredMarketPluginModules(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return parseMarketPluginModules(env[MARKET_PLUGIN_MODULES_ENV]);
}
