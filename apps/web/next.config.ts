import type { NextConfig } from "next";

/**
 * Railway backend URL — the Kakao webhook server that also serves
 * install pages, install scripts, and the relay API.
 *
 * Set RAILWAY_BACKEND_URL in Vercel env vars to point to your Railway deployment.
 * Example: https://your-moa-project.up.railway.app
 */
const RAILWAY_BACKEND =
  process.env.RAILWAY_BACKEND_URL ?? "https://openclaw-production-2e2e.up.railway.app";

const nextConfig: NextConfig = {
  output: "standalone",

  async rewrites() {
    return [
      // Install HTML page: moa.lawith.kr/install → Railway /install
      {
        source: "/install",
        destination: `${RAILWAY_BACKEND}/install`,
      },
      // Install scripts: moa.lawith.kr/install.sh → Railway /install.sh
      {
        source: "/install.sh",
        destination: `${RAILWAY_BACKEND}/install.sh`,
      },
      {
        source: "/install.ps1",
        destination: `${RAILWAY_BACKEND}/install.ps1`,
      },
      // Relay API: moa.lawith.kr/api/relay/* → Railway /api/relay/*
      {
        source: "/api/relay/:path*",
        destination: `${RAILWAY_BACKEND}/api/relay/:path*`,
      },
      // Kakao webhook: moa.lawith.kr/kakao/webhook → Railway /kakao/webhook
      {
        source: "/kakao/webhook",
        destination: `${RAILWAY_BACKEND}/kakao/webhook`,
      },
      // Health check proxy
      {
        source: "/health",
        destination: `${RAILWAY_BACKEND}/health`,
      },
    ];
  },
};

export default nextConfig;
