/**
 * OpenClaw Agent Bridge
 *
 * Connects MoA web app to the OpenClaw gateway for full agent capabilities:
 *   - Pi RPC agent with tools (browsing, file management, code execution)
 *   - 100+ skills (weather, calendar, search, coding, etc.)
 *   - Memory/knowledge base with vector search
 *   - Multi-turn conversation with context
 *   - Browser automation via Playwright
 *   - Plugin/extension system
 *
 * When the OpenClaw gateway is available, MoA routes queries through it
 * for enhanced responses. When unavailable, MoA falls back to direct LLM calls.
 *
 * Protocol: WebSocket JSON-RPC (connect per request in serverless context).
 */

import { randomUUID } from "node:crypto";

// ────────────────────────────────────────────
// Configuration
// ────────────────────────────────────────────
//
// NON-DEVELOPER USABILITY:
// All these environment variables are SERVER-SIDE ONLY.
// The operator (admin) sets them once in Vercel/Railway dashboard.
// End users (grandma, grandpa, anyone) never see or touch these.
// They just open the app and use it — zero configuration required.
//
// Required (for OpenClaw agent):
//   OPENCLAW_GATEWAY_URL  — OpenClaw gateway WebSocket URL
// Optional:
//   OPENCLAW_GATEWAY_TOKEN — Auth token (if gateway requires it)
//   OPENCLAW_TIMEOUT_MS   — Timeout in ms (default: 90s)
//   OPENCLAW_ENABLED      — Set "false" to disable (default: true)
//
// If none of these are set, MoA works in standalone mode with
// direct LLM calls — no OpenClaw agent features, but still fully functional.
// ────────────────────────────────────────────

/** OpenClaw gateway URL (ws:// or wss://) — server-side only */
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "";
/** Authentication token for the gateway — server-side only */
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
/** Request timeout in ms (default: 90s for complex agent tasks) */
const OPENCLAW_TIMEOUT_MS = parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "90000", 10);
/** Enable/disable OpenClaw integration (allows quick disable without removing env vars) */
const OPENCLAW_ENABLED = process.env.OPENCLAW_ENABLED !== "false";

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

/** Protocol frame types matching OpenClaw gateway protocol */
interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message: string; code: string };
}

interface EventFrame {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
  seq?: number;
}

type Frame = ResponseFrame | EventFrame;

export interface OpenClawResponse {
  text: string;
  model: string;
  sessionKey: string;
  toolsUsed: string[];
  skillsUsed: string[];
  tokenUsage: { input: number; output: number };
}

export interface OpenClawStatus {
  available: boolean;
  url: string;
  version?: string;
  skills?: string[];
  plugins?: string[];
  uptime?: number;
}

// ────────────────────────────────────────────
// Health Check (Cached)
// ────────────────────────────────────────────

let cachedStatus: { available: boolean; checkedAt: number } = {
  available: false,
  checkedAt: 0,
};
const HEALTH_CACHE_MS = 30_000; // 30s cache

/**
 * Check if the OpenClaw gateway is available.
 * Results are cached for 30s to avoid repeated connection attempts.
 */
export async function isOpenClawAvailable(): Promise<boolean> {
  if (!OPENCLAW_ENABLED || !OPENCLAW_GATEWAY_URL) return false;

  const now = Date.now();
  if (now - cachedStatus.checkedAt < HEALTH_CACHE_MS) {
    return cachedStatus.available;
  }

  try {
    // Convert ws:// to http:// for health check
    const httpUrl = OPENCLAW_GATEWAY_URL
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:");

    const healthUrl = `${httpUrl}/health`;
    const res = await fetch(healthUrl, {
      signal: AbortSignal.timeout(5_000),
    });

    const available = res.ok;
    cachedStatus = { available, checkedAt: now };
    return available;
  } catch {
    cachedStatus = { available: false, checkedAt: now };
    return false;
  }
}

/**
 * Get detailed OpenClaw gateway status.
 */
export async function getOpenClawStatus(): Promise<OpenClawStatus> {
  if (!OPENCLAW_ENABLED || !OPENCLAW_GATEWAY_URL) {
    return { available: false, url: "" };
  }

  try {
    const httpUrl = OPENCLAW_GATEWAY_URL
      .replace(/^ws:/, "http:")
      .replace(/^wss:/, "https:");

    const res = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      return { available: false, url: OPENCLAW_GATEWAY_URL };
    }

    const data = await res.json() as Record<string, unknown>;
    return {
      available: true,
      url: OPENCLAW_GATEWAY_URL,
      version: data.version as string | undefined,
      skills: data.skills as string[] | undefined,
      plugins: (data.plugins as Record<string, unknown>[])?.map(
        (p) => (p.name ?? p.id) as string,
      ),
      uptime: data.uptime as number | undefined,
    };
  } catch {
    return { available: false, url: OPENCLAW_GATEWAY_URL };
  }
}

// ────────────────────────────────────────────
// WebSocket RPC Client (per-request, serverless-safe)
// ────────────────────────────────────────────

/**
 * Send a message through the OpenClaw agent via WebSocket gateway.
 *
 * This opens a WebSocket connection, authenticates, sends the message,
 * collects the streamed response, then closes the connection.
 * Designed for serverless environments (Vercel) where persistent
 * connections aren't possible.
 *
 * Returns null if the gateway is unavailable or the request fails,
 * allowing the caller to fall back to direct LLM calls.
 */
export async function sendToOpenClawAgent(params: {
  message: string;
  userId: string;
  sessionKey?: string;
  channel?: string;
  category?: string;
  timeoutMs?: number;
}): Promise<OpenClawResponse | null> {
  if (!OPENCLAW_ENABLED || !OPENCLAW_GATEWAY_URL) return null;

  const available = await isOpenClawAvailable();
  if (!available) return null;

  const {
    message,
    userId,
    sessionKey = `moa:${userId}`,
    channel = "web",
    timeoutMs = OPENCLAW_TIMEOUT_MS,
  } = params;

  // Use dynamic import for WebSocket in Node.js serverless
  const WebSocket = (await import("ws")).default;

  return new Promise<OpenClawResponse | null>((resolve) => {
    const ws = new WebSocket(OPENCLAW_GATEWAY_URL, {
      handshakeTimeout: 10_000,
    });

    const connectId = randomUUID();
    const sendId = randomUUID();
    const idempotencyKey = randomUUID();

    let responseText = "";
    let modelUsed = "";
    const toolsUsed: string[] = [];
    const skillsUsed: string[] = [];
    let tokenUsage = { input: 0, output: 0 };
    let connected = false;
    let targetRunId = "";

    // Timeout: resolve null if we don't get a response in time
    const timer = setTimeout(() => {
      console.warn(`[openclaw-bridge] Timeout after ${timeoutMs}ms`);
      cleanup();
      resolve(null);
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
    }

    function sendReq(frame: RequestFrame) {
      ws.send(JSON.stringify(frame));
    }

    ws.on("error", (err) => {
      console.error("[openclaw-bridge] WebSocket error:", err.message);
      cleanup();
      resolve(null);
    });

    ws.on("close", () => {
      if (responseText) {
        // We got a response before close — return it
        resolve({
          text: responseText,
          model: modelUsed || "openclaw/agent",
          sessionKey,
          toolsUsed,
          skillsUsed,
          tokenUsage,
        });
      } else {
        resolve(null);
      }
      clearTimeout(timer);
    });

    ws.on("open", () => {
      // Step 1: Authenticate
      sendReq({
        type: "req",
        id: connectId,
        method: "connect",
        params: {
          minProtocol: 1,
          maxProtocol: 1,
          client: {
            id: `moa-web-${userId.slice(0, 8)}`,
            displayName: `MoA Web (${channel})`,
            version: "1.0.0",
            platform: "web",
            mode: "backend",
            instanceId: randomUUID(),
          },
          auth: OPENCLAW_GATEWAY_TOKEN ? { token: OPENCLAW_GATEWAY_TOKEN } : {},
          scopes: ["operator.admin"],
        },
      });
    });

    ws.on("message", (raw: Buffer) => {
      let frame: Frame;
      try {
        frame = JSON.parse(raw.toString()) as Frame;
      } catch {
        return;
      }

      // Handle response frames
      if (frame.type === "res") {
        const res = frame as ResponseFrame;

        if (res.id === connectId) {
          // Connection established
          if (res.ok) {
            connected = true;
            // Step 2: Send the chat message
            sendReq({
              type: "req",
              id: sendId,
              method: "chat.send",
              params: {
                sessionKey,
                message,
                idempotencyKey,
                timeoutMs,
              },
            });
          } else {
            console.error("[openclaw-bridge] Connect failed:", res.error?.message);
            cleanup();
            resolve(null);
          }
        } else if (res.id === sendId) {
          // chat.send acknowledged
          if (res.ok && res.payload) {
            targetRunId = (res.payload.runId as string) ?? "";
          } else {
            console.error("[openclaw-bridge] chat.send failed:", res.error?.message);
            cleanup();
            resolve(null);
          }
        }
      }

      // Handle event frames (streamed response)
      if (frame.type === "event") {
        const evt = frame as EventFrame;

        if (evt.event === "chat") {
          const payload = evt.payload;
          const state = payload.state as string;

          // Accumulate streaming text
          if (payload.delta) {
            const delta = payload.delta as { type: string; text?: string };
            if (delta.type === "text" && delta.text) {
              responseText += delta.text;
            }
          }

          // Track tool usage
          if (payload.tool) {
            const tool = payload.tool as { name?: string };
            if (tool.name && !toolsUsed.includes(tool.name)) {
              toolsUsed.push(tool.name);
            }
          }

          // Final response — collect and close
          if (state === "final") {
            const msg = payload.message as {
              content?: Array<{ type: string; text?: string }>;
              stopReason?: string;
              usage?: { input: number; output: number; totalTokens?: number };
              model?: string;
            } | undefined;

            if (msg) {
              // Extract final text from message content
              if (msg.content) {
                const textParts = msg.content
                  .filter((c) => c.type === "text" && c.text)
                  .map((c) => c.text)
                  .join("\n");
                if (textParts) responseText = textParts;
              }
              if (msg.usage) tokenUsage = { input: msg.usage.input, output: msg.usage.output };
              if (msg.model) modelUsed = msg.model;
            }

            cleanup();
            resolve({
              text: responseText,
              model: modelUsed || "openclaw/agent",
              sessionKey,
              toolsUsed,
              skillsUsed,
              tokenUsage,
            });
          }

          // Error state
          if (state === "error") {
            console.error("[openclaw-bridge] Agent error:", payload.errorMessage);
            cleanup();
            // Return partial response if we have one, otherwise null
            if (responseText) {
              resolve({
                text: responseText,
                model: modelUsed || "openclaw/agent",
                sessionKey,
                toolsUsed,
                skillsUsed,
                tokenUsage,
              });
            } else {
              resolve(null);
            }
          }
        }

        // Track agent events (tool/skill usage)
        if (evt.event === "agent") {
          const payload = evt.payload;
          if (payload.toolName && !toolsUsed.includes(payload.toolName as string)) {
            toolsUsed.push(payload.toolName as string);
          }
          if (payload.skillName && !skillsUsed.includes(payload.skillName as string)) {
            skillsUsed.push(payload.skillName as string);
          }
        }
      }
    });
  });
}

/**
 * Check if OpenClaw agent integration is configured.
 * Does not verify availability — use isOpenClawAvailable() for that.
 */
export function isOpenClawConfigured(): boolean {
  return OPENCLAW_ENABLED && !!OPENCLAW_GATEWAY_URL;
}
