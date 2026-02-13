/**
 * Gateway HTTP Server
 *
 * Handles:
 *   - POST /webhook/:channel — channel-specific webhooks
 *   - GET  /health           — health check + plugin status
 *   - POST /admin/allowlist  — manage channel allowlists
 *   - POST /admin/unban      — unban a rate-limited user
 *
 * Uses node:http (lean, no framework deps).
 * Benchmarked from OpenClaw's server.impl.ts pattern.
 */

import { createServer, type IncomingMessage as HttpRequest, type ServerResponse } from "node:http";
import type { GatewayConfig } from "./config.js";
import type { RateLimiter } from "./security/rate-limiter.js";
import type { Allowlist } from "./security/allowlist.js";
import { verifyAdminToken } from "./security/auth.js";
import { registry } from "./plugins/registry.js";
import { processMessage } from "./pipeline/process.js";
import { logger } from "./logger.js";

interface ServerDeps {
  config: GatewayConfig;
  rateLimiter: RateLimiter;
  allowlist: Allowlist;
}

/** Read the full request body as a string */
function readBody(req: HttpRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 1_048_576; // 1MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Send a JSON response */
function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  });
  res.end(body);
}

/** Parse request URL into path and method */
function parseRequest(req: HttpRequest): { method: string; path: string } {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return { method: req.method ?? "GET", path: url.pathname };
}

/** Collect headers into a plain object */
function getHeaders(req: HttpRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  return headers;
}

export function createGatewayServer(deps: ServerDeps) {
  const { config, rateLimiter, allowlist } = deps;

  const server = createServer(async (req, res) => {
    const { method, path } = parseRequest(req);

    try {
      // Health check
      if (path === "/health" && method === "GET") {
        return json(res, 200, {
          status: "ok",
          uptime: process.uptime(),
          plugins: registry.status(),
          rateLimit: rateLimiter.stats(),
          allowlist: allowlist.status(),
        });
      }

      // Webhook endpoints
      if (path.startsWith("/webhook/") && method === "POST") {
        const body = await readBody(req);
        const headers = getHeaders(req);
        const plugin = registry.findByWebhookPath(path);

        if (!plugin) {
          return json(res, 404, { error: "Unknown channel" });
        }

        if (!plugin.handleWebhook) {
          return json(res, 405, { error: "Channel does not support webhooks" });
        }

        const result = await plugin.handleWebhook(path, method, headers, body);

        // Send webhook response immediately (fast ack)
        if (result.responseHeaders) {
          for (const [k, v] of Object.entries(result.responseHeaders)) {
            res.setHeader(k, v);
          }
        }
        json(res, result.statusCode, result.responseBody ?? { ok: true });

        // Process messages asynchronously (don't block webhook response)
        for (const msg of result.messages) {
          processMessage(msg, { config, rateLimiter, allowlist }).catch((err) => {
            logger.error("Async message processing failed", {
              channel: msg.channel,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        return;
      }

      // Admin: manage allowlist
      if (path === "/admin/allowlist" && method === "POST") {
        if (!verifyAdminToken(req.headers.authorization, config.moaApiSecret)) {
          return json(res, 401, { error: "Unauthorized" });
        }

        const body = JSON.parse(await readBody(req)) as {
          action: "add" | "remove" | "set_mode";
          channel: string;
          userId?: string;
          mode?: string;
        };

        if (body.action === "add" && body.userId) {
          allowlist.addUser(body.channel, body.userId);
        } else if (body.action === "remove" && body.userId) {
          allowlist.removeUser(body.channel, body.userId);
        } else if (body.action === "set_mode" && body.mode) {
          allowlist.setMode(body.channel, body.mode as "open" | "allowlist" | "disabled");
        }

        return json(res, 200, { ok: true, allowlist: allowlist.status() });
      }

      // Admin: unban user
      if (path === "/admin/unban" && method === "POST") {
        if (!verifyAdminToken(req.headers.authorization, config.moaApiSecret)) {
          return json(res, 401, { error: "Unauthorized" });
        }

        const body = JSON.parse(await readBody(req)) as {
          channel: string;
          userId: string;
        };

        rateLimiter.unban(body.channel, body.userId);
        return json(res, 200, { ok: true, message: "User unbanned" });
      }

      // 404 for everything else
      json(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Request handler error", { method, path, error: message });
      json(res, 500, { error: "Internal server error" });
    }
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(config.port, config.host, () => {
          logger.info("Gateway server started", {
            host: config.host,
            port: config.port,
            env: config.env,
          });
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      await registry.shutdownAll();
      rateLimiter.destroy();

      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
