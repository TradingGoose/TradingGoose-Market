import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  output: undefined,
  async rewrites() {
    return [
      {
        source: "/files/serve/:path+",
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
