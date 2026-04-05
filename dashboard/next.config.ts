import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
