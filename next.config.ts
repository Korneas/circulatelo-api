import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/circulatelo-api",
  assetPrefix: "/circulatelo-api",
};

export default nextConfig;
// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
