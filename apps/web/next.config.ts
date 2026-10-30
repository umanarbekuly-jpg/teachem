import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  transpilePackages: ["@tutor/shared"],
  poweredByHeader: false,
  async rewrites() {
    const target = new URL(
      process.env.API_INTERNAL_URL ?? "http://localhost:4000/api/v1",
    ).origin;
    return [{ source: "/api/:path*", destination: `${target}/api/:path*` }];
  },
  experimental: { cpus: 2 },
};
export default config;
