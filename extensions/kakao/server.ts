/**
 * MoA (Master of AI) — Standalone Kakao Webhook Server
 *
 * Railway/Docker entry point that starts the Kakao webhook directly
 * without requiring the full OpenClaw gateway.
 *
 * Usage: ./node_modules/.bin/tsx extensions/kakao/server.ts
 */

// Immediate startup log — if you see this in Railway deploy logs,
// it means server.ts is running (not the OpenClaw CLI)
console.log("[MoA] server.ts entry point loaded — this is the MoA webhook server, NOT OpenClaw CLI");

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { startKakaoWebhook } from "./src/webhook.js";
import { resolveKakaoAccount, getDefaultKakaoConfig } from "./src/config.js";
import type { ResolvedKakaoAccount } from "./src/types.js";

const PORT = parseInt(process.env.PORT ?? process.env.KAKAO_WEBHOOK_PORT ?? "8788", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEBHOOK_PATH = process.env.KAKAO_WEBHOOK_PATH ?? "/kakao/webhook";

/**
 * Build a minimal account config from environment variables
 */
function buildAccountFromEnv(): ResolvedKakaoAccount | null {
  // Try resolving via standard config mechanism (reads env vars internally)
  const account = resolveKakaoAccount({
    cfg: {
      channels: {
        kakao: {
          accounts: {
            default: getDefaultKakaoConfig(),
          },
        },
      },
    },
    accountId: "default",
  });

  if (account) {
    // Override webhook settings from env
    account.config = {
      ...account.config,
      webhookPort: PORT,
      webhookPath: WEBHOOK_PATH,
    };
    return account;
  }

  // Build minimal account even without Kakao keys (webhook still works for health checks)
  return {
    accountId: "default",
    enabled: true,
    appKey: process.env.KAKAO_APP_KEY ?? process.env.KAKAO_JAVASCRIPT_KEY ?? "",
    adminKey: process.env.KAKAO_ADMIN_KEY ?? process.env.KAKAO_REST_API_KEY ?? "",
    channelId: process.env.KAKAO_CHANNEL_ID,
    senderKey: process.env.KAKAO_SENDER_KEY,
    toastAppKey: process.env.TOAST_APP_KEY,
    toastSecretKey: process.env.TOAST_SECRET_KEY,
    config: {
      ...getDefaultKakaoConfig(),
      webhookPort: PORT,
      webhookPath: WEBHOOK_PATH,
    },
  };
}

/**
 * Default message handler when no external agent is connected
 */
async function defaultOnMessage(params: {
  userId: string;
  userType: string;
  text: string;
  botId: string;
  blockId: string;
  timestamp: number;
}): Promise<{ text: string; quickReplies?: string[] }> {
  return {
    text: `메시지를 받았습니다: "${params.text.slice(0, 100)}"`,
    quickReplies: ["도움말", "잔액", "AI 모드"],
  };
}

async function main() {
  console.log(`[MoA] Starting standalone webhook server...`);
  console.log(`[MoA] PORT=${PORT}, HOST=${HOST}, PATH=${WEBHOOK_PATH}`);

  const account = buildAccountFromEnv();
  if (!account) {
    console.error("[MoA] Failed to build account config");
    process.exit(1);
  }

  const hasKeys = !!(account.appKey || account.adminKey);
  if (!hasKeys) {
    console.warn("[MoA] WARNING: No Kakao API keys configured (KAKAO_ADMIN_KEY or KAKAO_APP_KEY)");
    console.warn("[MoA] Webhook will start but message handling may be limited");
  }

  try {
    const webhook = await startKakaoWebhook({
      account,
      port: PORT,
      host: HOST,
      path: WEBHOOK_PATH,
      onMessage: defaultOnMessage,
      logger: console,
    });

    console.log(`[MoA] Webhook server started at ${webhook.url}`);
    console.log(`[MoA] Health check: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/health`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`[MoA] Received ${signal}, shutting down...`);
      await webhook.stop();
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (err) {
    console.error("[MoA] Failed to start webhook server:", err);
    process.exit(1);
  }
}

main();
