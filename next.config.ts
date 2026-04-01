import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    useWasmBinary: true,
  },
};

export default nextConfig;
