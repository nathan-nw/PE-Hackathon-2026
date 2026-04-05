import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "scontent-yyz1-1.xx.fbcdn.net",
        pathname: "/v/**",
      },
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
