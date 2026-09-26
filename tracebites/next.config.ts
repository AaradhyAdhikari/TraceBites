import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Harvest photos are stored as data URIs in dev; raise the action body limit.
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
};

export default nextConfig;
