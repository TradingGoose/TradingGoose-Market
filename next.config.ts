import type { NextConfig } from "next";
import { getConfiguredMarketPluginModules } from "./lib/market-api/plugins/config";

const marketPluginModules = getConfiguredMarketPluginModules();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  output: undefined,
  serverExternalPackages: marketPluginModules,
  async rewrites() {
    return [
      {
        source: "/search/:path*",
        destination: "/api/search/:path*?version=v1"
      },
      {
        source: "/update/:path*",
        destination: "/api/update/:path*?version=v1"
      },
      {
        source: "/files/serve/:path*",
        destination: "/api/files/serve/:path*"
      },
      {
        source: "/health",
        destination: "/api/health"
      }
    ];
  }
};

export default nextConfig;
