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
import { handleRelayRequest } from "./src/relay/index.js";
import { handleInstallRequest } from "./src/installer/index.js";
import { handlePaymentRequest } from "./src/payment/index.js";
import { isSupabaseConfigured } from "./src/supabase.js";
import { generateSystemPrompt } from "./src/lawcall-router.js";

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
 * Detect which LLM API key is available and return provider info
 */
function detectLlmProvider(): { provider: string; apiKey: string; model: string; endpoint: string } | null {
  // Priority: Anthropic > OpenAI > Google Gemini > Groq
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.MOA_MODEL ?? "claude-3-5-haiku-20241022",
      endpoint: "https://api.anthropic.com/v1/messages",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.MOA_MODEL ?? "gpt-4o-mini",
      endpoint: "https://api.openai.com/v1/chat/completions",
    };
  }
  if (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY) {
    return {
      provider: "google",
      apiKey: (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY)!,
      model: process.env.MOA_MODEL ?? "gemini-2.0-flash",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    };
  }
  if (process.env.GROQ_API_KEY) {
    return {
      provider: "groq",
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.MOA_MODEL ?? "llama-3.3-70b-versatile",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
    };
  }
  return null;
}

/**
 * Call Anthropic API
 */
async function callAnthropic(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(25000), // Kakao has 5s timeout, but we give LLM more time
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Anthropic API ${response.status}: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.find(c => c.type === "text")?.text ?? "";
}

/**
 * Call OpenAI-compatible API (OpenAI, Groq)
 */
async function callOpenAICompatible(endpoint: string, apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`API ${response.status}: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`);
  }

  const data = await response.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

/**
 * Call Google Gemini API
 */
async function callGemini(apiKey: string, model: string, systemPrompt: string, userMessage: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 1000 },
      }),
      signal: AbortSignal.timeout(25000),
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`Gemini API ${response.status}: ${(err as { error?: { message?: string } }).error?.message ?? response.statusText}`);
  }

  const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ?? "";
}

/**
 * AI message handler — calls the configured LLM provider
 */
async function aiOnMessage(params: {
  userId: string;
  userType: string;
  text: string;
  botId: string;
  blockId: string;
  timestamp: number;
}): Promise<{ text: string; quickReplies?: string[] }> {
  const llm = detectLlmProvider();

  if (!llm) {
    return {
      text: "AI 모델이 설정되지 않았습니다. 서버 관리자에게 문의하세요.\n\n(ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, 또는 GROQ_API_KEY 환경변수가 필요합니다)",
      quickReplies: ["도움말"],
    };
  }

  const systemPrompt = generateSystemPrompt();

  try {
    let responseText: string;

    switch (llm.provider) {
      case "anthropic":
        responseText = await callAnthropic(llm.apiKey, llm.model, systemPrompt, params.text);
        break;
      case "openai":
        responseText = await callOpenAICompatible(llm.endpoint, llm.apiKey, llm.model, systemPrompt, params.text);
        break;
      case "google":
        responseText = await callGemini(llm.apiKey, llm.model, systemPrompt, params.text);
        break;
      case "groq":
        responseText = await callOpenAICompatible(llm.endpoint, llm.apiKey, llm.model, systemPrompt, params.text);
        break;
      default:
        responseText = "지원되지 않는 AI 제공자입니다.";
    }

    // Truncate to Kakao's limit
    if (responseText.length > 950) {
      responseText = responseText.slice(0, 947) + "...";
    }

    return {
      text: responseText,
      quickReplies: ["도움말"],
    };
  } catch (err) {
    console.error(`[MoA] LLM API error (${llm.provider}/${llm.model}):`, err);
    return {
      text: `AI 응답 생성 중 오류가 발생했습니다.\n\n${err instanceof Error ? err.message : String(err)}`,
      quickReplies: ["도움말"],
    };
  }
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

  // Detect LLM provider
  const llm = detectLlmProvider();
  if (llm) {
    console.log(`[MoA] LLM provider: ${llm.provider} (model: ${llm.model})`);
  } else {
    console.warn("[MoA] WARNING: No LLM API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or GROQ_API_KEY");
  }

  // Check Supabase
  if (isSupabaseConfigured()) {
    console.log("[MoA] Supabase: configured (billing & sync enabled)");
  } else {
    console.log("[MoA] Supabase: not configured (billing & sync disabled, AI chat still works)");
  }

  try {
    const webhook = await startKakaoWebhook({
      account,
      port: PORT,
      host: HOST,
      path: WEBHOOK_PATH,
      onMessage: aiOnMessage,
      logger: console,
      // Mount install page, relay API, and payment routes on the same server
      requestInterceptor: (req, res) => {
        // Try install page first (/install)
        if (handleInstallRequest(req, res)) return true;
        // Then try payment callbacks (/payment/*)
        if (handlePaymentRequest(req, res, console)) return true;
        // Then try relay API (/api/relay/*)
        return handleRelayRequest(req, res, console);
      },
    });

    console.log(`[MoA] Webhook server started at ${webhook.url}`);
    console.log(`[MoA] Install page: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/install`);
    console.log(`[MoA] Payment API: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/payment/*`);
    console.log(`[MoA] Relay API: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/api/relay/*`);
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
