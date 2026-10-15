import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (stage 7).
  output: "standalone",
  // Native module: keep it out of the bundler, load from node_modules at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
