/**
 * MoA Gateway Server — Entry Point
 *
 * Multi-channel AI message gateway that bridges messaging platforms
 * to the MoA AI engine (running on Vercel).
 *
 * Architecture (benchmarked from OpenClaw Gateway):
 *   - Plugin-based channel adapters (each platform = one plugin)
 *   - HMAC-SHA256 authenticated API calls to MoA Web API
 *   - 3-strike rate limiting with permanent ban escalation
 *   - Channel allowlists (open / allowlist / disabled per channel)
 *   - Input validation (injection detection) + sensitive data masking
 *   - Structured JSON logging
 *
 * Supported channels:
 *   Signal, Matrix, MS Teams, Google Chat, Mattermost,
 *   Nextcloud Talk, Zalo, Twitch, Nostr, BlueBubbles, Tlon, iMessage
 *
 * (Telegram, Discord, Slack, LINE, WhatsApp, KakaoTalk are handled
 *  directly by Vercel webhooks — see apps/web/)
 */

import { loadConfig } from "./config.js";
import { createGatewayServer } from "./server.js";
import { RateLimiter } from "./security/rate-limiter.js";
import { Allowlist } from "./security/allowlist.js";
import { registry } from "./plugins/registry.js";
import { registerAllAdapters } from "./adapters/index.js";
import { processMessage } from "./pipeline/process.js";
import { logger } from "./logger.js";
import { SignalAdapter } from "./adapters/signal.js";
import { MatrixAdapter } from "./adapters/matrix.js";

async function main(): Promise<void> {
  logger.info("MoA Gateway starting...");

  // Load configuration
  const config = loadConfig();

  // Initialize security
  const rateLimiter = new RateLimiter({
    maxPerMinute: config.rateLimitPerMinute,
    maxStrikes: config.maxStrikes,
    strikeCooldownMs: config.strikeCooldownMs,
  });
  const allowlist = new Allowlist();

  // Register all channel adapters
  registerAllAdapters();

  // Wire up polling-based adapters (Signal, Matrix) to the pipeline
  const pipelineDeps = { config, rateLimiter, allowlist };

  for (const plugin of registry.getAll()) {
    if (plugin instanceof SignalAdapter || plugin instanceof MatrixAdapter) {
      plugin.onMessage((msg) => {
        processMessage(msg, pipelineDeps).catch((err) => {
          logger.error("Polling message processing failed", {
            channel: msg.channel,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      });
    }
  }

  // Initialize all configured plugins
  await registry.initializeAll(config);

  // Start HTTP server
  const server = createGatewayServer({ config, rateLimiter, allowlist });
  await server.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info("Shutting down...", { signal });
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("MoA Gateway ready", {
    port: config.port,
    activePlugins: registry.getActive().map((p) => p.channel),
    env: config.env,
  });
}

main().catch((err) => {
  logger.error("Fatal startup error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
