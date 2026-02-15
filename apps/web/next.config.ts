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

/**
 * MoA Gateway server URL — handles 12 additional messaging channels
 * (Signal, Matrix, MS Teams, Google Chat, Mattermost, Nextcloud Talk,
 *  Zalo, Twitch, Nostr, BlueBubbles, Tlon, iMessage).
 *
 * Set MOA_GATEWAY_URL in Vercel env vars to point to your Gateway deployment.
 * Example: https://moa-gateway.fly.dev or http://gateway:8900 (Docker)
 */
const GATEWAY_BACKEND = process.env.MOA_GATEWAY_URL ?? "";

const nextConfig: NextConfig = {
  output: "standalone",

  // PptxGenJS uses node: protocol imports — handle for client bundles
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Polyfill node: protocol URIs to empty modules for browser builds
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        https: false,
        http: false,
        stream: false,
        zlib: false,
      };
      // Handle node: prefix scheme
      config.plugins.push(
        new (require("webpack")).NormalModuleReplacementPlugin(
          /^node:/,
          (resource: { request: string }) => {
            resource.request = resource.request.replace(/^node:/, "");
          },
        ),
      );
    }
    return config;
  },

  async rewrites() {
    const rules = [
      // Install HTML page: mymoa.app/install → Railway /install
      {
        source: "/install",
        destination: `${RAILWAY_BACKEND}/install`,
      },
      // Install scripts: mymoa.app/install.sh → Railway /install.sh
      {
        source: "/install.sh",
        destination: `${RAILWAY_BACKEND}/install.sh`,
      },
      {
        source: "/install.ps1",
        destination: `${RAILWAY_BACKEND}/install.ps1`,
      },
      // One-click installer wrappers
      {
        source: "/install.bat",
        destination: `${RAILWAY_BACKEND}/install.bat`,
      },
      {
        source: "/install.command",
        destination: `${RAILWAY_BACKEND}/install.command`,
      },
      // Relay API: mymoa.app/api/relay/* → Railway /api/relay/*
      {
        source: "/api/relay/:path*",
        destination: `${RAILWAY_BACKEND}/api/relay/:path*`,
      },
      // Kakao webhook: mymoa.app/kakao/webhook → Railway /kakao/webhook
      {
        source: "/kakao/webhook",
        destination: `${RAILWAY_BACKEND}/kakao/webhook`,
      },
      // Telegram webhook proxy
      {
        source: "/telegram/webhook",
        destination: `${RAILWAY_BACKEND}/telegram/webhook`,
      },
      // WhatsApp webhook proxy
      {
        source: "/whatsapp/webhook",
        destination: `${RAILWAY_BACKEND}/whatsapp/webhook`,
      },
      // Discord webhook proxy
      {
        source: "/discord/webhook",
        destination: `${RAILWAY_BACKEND}/discord/webhook`,
      },
      // Slack webhook proxy
      {
        source: "/slack/webhook",
        destination: `${RAILWAY_BACKEND}/slack/webhook`,
      },
      // LINE webhook proxy
      {
        source: "/line/webhook",
        destination: `${RAILWAY_BACKEND}/line/webhook`,
      },
      // Health check proxy
      {
        source: "/health",
        destination: `${RAILWAY_BACKEND}/health`,
      },
      // Post-install welcome/guide page
      {
        source: "/welcome",
        destination: `${RAILWAY_BACKEND}/welcome`,
      },
      // Channel settings page
      {
        source: "/settings",
        destination: `${RAILWAY_BACKEND}/settings`,
      },
      {
        source: "/settings/:path*",
        destination: `${RAILWAY_BACKEND}/settings/:path*`,
      },
    ];

    // Gateway webhook proxies — only add when Gateway URL is configured.
    // mymoa.app/webhook/:channel → Gateway /webhook/:channel
    // This allows a single domain for all channel webhooks.
    if (GATEWAY_BACKEND) {
      rules.push(
        // Gateway channel webhooks (Signal, Matrix, Teams, etc.)
        {
          source: "/webhook/:channel*",
          destination: `${GATEWAY_BACKEND}/webhook/:channel*`,
        },
        // Gateway health check
        {
          source: "/gateway/health",
          destination: `${GATEWAY_BACKEND}/health`,
        },
        // Gateway admin API
        {
          source: "/gateway/admin/:path*",
          destination: `${GATEWAY_BACKEND}/admin/:path*`,
        },
      );
    }

    return rules;
  },
};

export default nextConfig;
