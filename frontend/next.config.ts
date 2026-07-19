import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory. Without this, Next.js walks up
  // and finds ~/package-lock.json (an unrelated project) and warns about
  // ambiguous root inference.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
