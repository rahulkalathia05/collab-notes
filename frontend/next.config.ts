import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enables `node server.js` in the Docker production image.
  // Has no effect during `next dev` or `next start`.
  output: "standalone",
};

export default nextConfig;
