/**
 * SLM Router - Local Gatekeeper + Cloud Dispatch
 *
 * Architecture:
 * - Qwen3-0.6B (local, always-on): lightweight gatekeeper
 * - Gemini 2.0 Flash (cloud): handles all substantive work
 *
 * Qwen3-0.6B role (100% reliable at 0.6B parameter size):
 * 1. Intent classification → JSON { category, tool_needed, confidence }
 * 2. Greeting detection → direct simple response
 * 3. Heartbeat check → "are there pending tasks?" (yes/no)
 * 4. Privacy detection → flag sensitive data patterns
 * 5. Tool routing → which tool to call
 *
 * Everything else → Gemini 2.0 Flash (cloud, cost-effective)
 */

import {
  SLM_CORE_MODEL,
  CLOUD_FALLBACK_MODEL,
  CLOUD_FALLBACK_PROVIDER,
  OLLAMA_API,
  isOllamaRunning,
  checkCoreModelStatus,
  autoRecover,
} from "./ollama-installer.js";

// ============================================
// Types
// ============================================

export interface SLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SLMRequest {
  messages: SLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface SLMResponse {
  content: string;
  model: string;
  isLocal: boolean;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface RoutingDecision {
  category: "simple" | "medium" | "complex" | "specialized";
  toolNeeded: string | null;
  targetLLM: "local" | "cloud";
  confidence: number;
  reason: string;
}

export interface SLMRouterResult {
  success: boolean;
  response?: SLMResponse;
  routingDecision?: RoutingDecision;
  error?: string;
  /** When true, caller should dispatch to Gemini 2.0 Flash */
  shouldRouteToCloud?: boolean;
  cloudModel?: string;
  cloudProvider?: string;
}

// ============================================
// System Prompts (optimized for 0.6B model)
// ============================================

// Keep prompts short and structured for small model reliability
const ROUTING_PROMPT = `You are a message router. Classify the user message and respond ONLY with JSON:

{
  "category": "simple|medium|complex|specialized",
  "tool_needed": "calendar|file|search|email|browser|none",
  "target_llm": "local|cloud",
  "confidence": 0.0-1.0,
  "reason": "brief reason"
}

Rules:
- simple: greetings, time, weather, yes/no questions → local
- medium: schedule, file search, basic lookup → cloud (needs tool)
- complex: code, analysis, math, translation, long text → cloud
- specialized: legal, medical, expert domain → cloud

/no_think`;

const SIMPLE_RESPONSE_PROMPT = `You are MoA agent. Respond briefly in Korean.
Only handle simple greetings and basic questions.
If unsure, say "잠시만요, 더 정확한 답변을 준비하겠습니다."

/no_think`;

const HEARTBEAT_CHECK_PROMPT = `You are checking task status. Given a task list, respond ONLY with JSON:

{
  "has_pending_tasks": true|false,
  "task_count": 0,
  "needs_attention": true|false,
  "summary": "brief status"
}

/no_think`;

// ============================================
// Ollama API Call
// ============================================

async function callOllama(
  model: string,
  messages: SLMMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
  },
): Promise<{
  content: string;
  promptTokens: number;
  completionTokens: number;
}> {
  const response = await fetch(`${OLLAMA_API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        num_predict: options?.maxTokens ?? 256,
        temperature: options?.temperature ?? 0.1,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Ollama API error: ${error}`);
  }

  const data = (await response.json()) as {
    message: { content: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  // Strip thinking blocks if present
  let content = data.message.content;
  content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();

  return {
    content,
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  };
}

// ============================================
// Core Router Functions
// ============================================

/**
 * Use Qwen3-0.6B to classify intent and decide routing
 */
export async function classifyIntent(userMessage: string): Promise<RoutingDecision> {
  const startTime = Date.now();

  try {
    const result = await callOllama(
      SLM_CORE_MODEL.ollamaName,
      [
        { role: "system", content: ROUTING_PROMPT },
        { role: "user", content: userMessage },
      ],
      { maxTokens: 256, temperature: 0.1 },
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse routing decision");
    }

    const decision = JSON.parse(jsonMatch[0]) as {
      category: string;
      tool_needed: string;
      target_llm: string;
      confidence: number;
      reason: string;
    };

    const latency = Date.now() - startTime;
    console.log(`[SLM] Intent classification: ${latency}ms, target: ${decision.target_llm}`);

    return {
      category: decision.category as RoutingDecision["category"],
      toolNeeded: decision.tool_needed === "none" ? null : decision.tool_needed,
      targetLLM: decision.target_llm === "local" ? "local" : "cloud",
      confidence: decision.confidence,
      reason: decision.reason,
    };
  } catch (error) {
    // On classification failure, default to cloud (safer)
    console.warn("[SLM] Intent classification failed, routing to cloud:", error);
    return {
      category: "medium",
      toolNeeded: null,
      targetLLM: "cloud",
      confidence: 0.5,
      reason: "classification fallback",
    };
  }
}

/**
 * Use Qwen3-0.6B for simple direct response (greetings only)
 */
async function respondLocally(
  messages: SLMMessage[],
  options?: { maxTokens?: number },
): Promise<SLMResponse> {
  const startTime = Date.now();

  const fullMessages: SLMMessage[] = [
    { role: "system", content: SIMPLE_RESPONSE_PROMPT },
    ...messages,
  ];

  const result = await callOllama(SLM_CORE_MODEL.ollamaName, fullMessages, {
    maxTokens: options?.maxTokens ?? 256,
    temperature: 0.7,
  });

  return {
    content: result.content,
    model: SLM_CORE_MODEL.ollamaName,
    isLocal: true,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.promptTokens + result.completionTokens,
    },
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Use Qwen3-0.6B to check heartbeat/task status
 *
 * Reads task list and makes a binary decision:
 * - Are there pending tasks? → call Gemini Flash for action
 * - No pending tasks? → return HEARTBEAT_OK
 */
export async function checkHeartbeatStatus(taskContent: string): Promise<{
  hasPendingTasks: boolean;
  needsAttention: boolean;
  summary: string;
  shouldCallCloud: boolean;
}> {
  try {
    const result = await callOllama(
      SLM_CORE_MODEL.ollamaName,
      [
        { role: "system", content: HEARTBEAT_CHECK_PROMPT },
        { role: "user", content: `Task list:\n${taskContent}` },
      ],
      { maxTokens: 128, temperature: 0.1 },
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        hasPendingTasks: false,
        needsAttention: false,
        summary: "상태 확인 불가",
        shouldCallCloud: false,
      };
    }

    const status = JSON.parse(jsonMatch[0]) as {
      has_pending_tasks: boolean;
      task_count: number;
      needs_attention: boolean;
      summary: string;
    };

    return {
      hasPendingTasks: status.has_pending_tasks,
      needsAttention: status.needs_attention,
      summary: status.summary,
      // Call Gemini Flash only if there are tasks needing attention
      shouldCallCloud: status.has_pending_tasks && status.needs_attention,
    };
  } catch (error) {
    console.warn("[SLM] Heartbeat check failed:", error);
    return {
      hasPendingTasks: false,
      needsAttention: false,
      summary: "heartbeat check failed",
      shouldCallCloud: false,
    };
  }
}

/**
 * Use Qwen3-0.6B to detect if user needs follow-up after interval
 *
 * After an interval of inactivity, checks if user might need prompting
 */
export async function checkUserFollowUp(
  lastContext: string,
): Promise<{
  needsFollowUp: boolean;
  reason: string;
  shouldCallCloud: boolean;
}> {
  try {
    const result = await callOllama(
      SLM_CORE_MODEL.ollamaName,
      [
        {
          role: "system",
          content: `Given the last conversation context, decide if the user needs a follow-up.
Respond ONLY with JSON:
{
  "needs_follow_up": true|false,
  "reason": "brief reason"
}

Rules:
- true: if there was an incomplete task or unanswered question
- false: if conversation was completed or user said goodbye

/no_think`,
        },
        { role: "user", content: `Last context:\n${lastContext}` },
      ],
      { maxTokens: 128, temperature: 0.1 },
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { needsFollowUp: false, reason: "parse failed", shouldCallCloud: false };
    }

    const decision = JSON.parse(jsonMatch[0]) as {
      needs_follow_up: boolean;
      reason: string;
    };

    return {
      needsFollowUp: decision.needs_follow_up,
      reason: decision.reason,
      // If follow-up needed, Gemini Flash generates the actual message
      shouldCallCloud: decision.needs_follow_up,
    };
  } catch {
    return { needsFollowUp: false, reason: "check failed", shouldCallCloud: false };
  }
}

// ============================================
// Main SLM Router
// ============================================

/**
 * Smart routing: Qwen3-0.6B classifies, then dispatches
 *
 * Flow:
 * 1. Ensure Ollama is running
 * 2. Qwen3-0.6B classifies intent
 * 3. Simple greetings → local response
 * 4. Everything else → signal to caller to use Gemini 2.0 Flash
 */
export async function routeSLM(
  userMessage: string,
  request: SLMRequest,
  options?: {
    forceLocal?: boolean;
    skipRouting?: boolean;
  },
): Promise<SLMRouterResult> {
  try {
    // Ensure Ollama is running
    if (!(await isOllamaRunning())) {
      const recovered = await autoRecover();
      if (!recovered) {
        return {
          success: false,
          error: "로컬 AI 서버를 시작할 수 없습니다",
          shouldRouteToCloud: true,
          cloudModel: CLOUD_FALLBACK_MODEL,
          cloudProvider: CLOUD_FALLBACK_PROVIDER,
        };
      }
    }

    // Check core model is installed
    const status = await checkCoreModelStatus();
    if (!status.coreReady) {
      return {
        success: false,
        error: "에이전트 코어 모델이 설치되지 않았습니다",
        shouldRouteToCloud: true,
        cloudModel: CLOUD_FALLBACK_MODEL,
        cloudProvider: CLOUD_FALLBACK_PROVIDER,
      };
    }

    // Skip routing if requested (use local directly)
    if (options?.skipRouting) {
      const response = await respondLocally(request.messages, {
        maxTokens: request.maxTokens,
      });
      return { success: true, response };
    }

    // Step 1: Classify intent with Qwen3-0.6B
    const routingDecision = await classifyIntent(userMessage);

    // Step 2: Route based on decision
    if (routingDecision.targetLLM === "local" && routingDecision.category === "simple") {
      // Only handle simple greetings locally
      const response = await respondLocally(request.messages, {
        maxTokens: request.maxTokens,
      });
      return { success: true, response, routingDecision };
    }

    // Everything else → Gemini 2.0 Flash
    return {
      success: false,
      routingDecision,
      shouldRouteToCloud: true,
      cloudModel: CLOUD_FALLBACK_MODEL,
      cloudProvider: CLOUD_FALLBACK_PROVIDER,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "SLM 처리 실패",
      shouldRouteToCloud: true,
      cloudModel: CLOUD_FALLBACK_MODEL,
      cloudProvider: CLOUD_FALLBACK_PROVIDER,
    };
  }
}

// ============================================
// Utility Functions
// ============================================

export async function getSLMInfo(): Promise<{
  core: { model: string; status: "ready" | "not-installed" };
  cloudFallback: { model: string; provider: string };
  serverRunning: boolean;
}> {
  const running = await isOllamaRunning();
  const status = running ? await checkCoreModelStatus() : { coreReady: false };

  return {
    core: {
      model: SLM_CORE_MODEL.ollamaName,
      status: status.coreReady ? "ready" : "not-installed",
    },
    cloudFallback: {
      model: CLOUD_FALLBACK_MODEL,
      provider: CLOUD_FALLBACK_PROVIDER,
    },
    serverRunning: running,
  };
}
