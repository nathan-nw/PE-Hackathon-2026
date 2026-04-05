import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode", "@kubernetes/client-node"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
