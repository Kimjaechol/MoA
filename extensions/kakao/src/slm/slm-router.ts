/**
 * SLM Router - 2-Tier Local Model Processing
 *
 * Handles routing between:
 * - Tier 1: Qwen3-0.6B (always loaded, fast routing/intent)
 * - Tier 2: Qwen3-4B (on-demand, deep reasoning)
 *
 * Flow:
 * 1. Tier 1 analyzes message → determines if Tier 2 needed
 * 2. If simple → Tier 1 responds directly
 * 3. If complex + offline → Load Tier 2 for deep processing
 * 4. If complex + online → Route to cloud LLM
 */

import { SLM_MODELS, isOllamaRunning, checkMoaSLMStatus, autoRecover } from "./ollama-installer.js";

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
  enableThinking?: boolean; // Qwen3 thinking mode
}

export interface SLMResponse {
  content: string;
  model: string;
  tier: 1 | 2;
  thinking?: string; // Thinking output if enabled
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
  targetLLM: "tier1" | "tier2" | "cloud" | "specialized";
  confidence: number;
  reason: string;
}

export interface SLMRouterResult {
  success: boolean;
  response?: SLMResponse;
  routingDecision?: RoutingDecision;
  error?: string;
  shouldRouteToCloud?: boolean;
  cloudTarget?: string;
}

// ============================================
// Constants
// ============================================

const OLLAMA_API = "http://127.0.0.1:11434";

// Tier 1 routing prompt (optimized for fast intent classification)
const TIER1_ROUTING_PROMPT = `당신은 MoA 에이전트입니다. 사용자 요청을 분석하여 다음 JSON 형식으로만 응답하세요:

{
  "category": "simple|medium|complex|specialized",
  "tool_needed": "calendar|file|search|email|browser|none",
  "target_llm": "tier1|tier2|cloud|specialized",
  "confidence": 0.0-1.0,
  "reason": "판단 이유 (10자 이내)"
}

판단 기준:
- simple: 인사, 간단한 질문, 날씨, 시간 → tier1
- medium: 일정 관리, 파일 검색, 기본 검색 → tier1 + tool
- complex: 코드 작성, 문서 분석, 수학, 번역 → tier2 또는 cloud
- specialized: 법률, 의료, 전문 분야 → specialized

/no_think`;

// Tier 1 response prompt (for direct simple responses)
const TIER1_RESPONSE_PROMPT = `당신은 MoA 에이전트입니다. 친절하고 간결하게 한국어로 응답하세요.
도구 호출이 필요하면 다음 형식으로 응답하세요:
<tool_call>{"name": "도구명", "args": {...}}</tool_call>

/no_think`;

// Tier 2 reasoning prompt (for deep offline processing)
const TIER2_REASONING_PROMPT = `당신은 MoA 고급 추론 에이전트입니다. 복잡한 문제를 깊이 있게 분석하고 해결하세요.
단계별로 생각하고, 정확한 정보를 제공하세요.

/think`;

// ============================================
// Ollama API Calls
// ============================================

/**
 * Call Ollama chat API
 */
async function callOllama(
  model: string,
  messages: SLMMessage[],
  options?: {
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
  },
): Promise<{
  content: string;
  thinking?: string;
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
      stream: options?.stream ?? false,
      options: {
        num_predict: options?.maxTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
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

  // Parse thinking block if present
  let content = data.message.content;
  let thinking: string | undefined;

  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    content = content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
  }

  return {
    content,
    thinking,
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  };
}

/**
 * Load/unload model (for Tier 2 on-demand management)
 */
async function loadModel(model: string): Promise<boolean> {
  try {
    // Ollama auto-loads on first request, but we can warm it up
    await fetch(`${OLLAMA_API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "hi",
        options: { num_predict: 1 },
      }),
    });
    return true;
  } catch {
    return false;
  }
}

async function unloadModel(model: string): Promise<boolean> {
  try {
    // Unload by setting keep_alive to 0
    await fetch(`${OLLAMA_API}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "",
        keep_alive: 0,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

// ============================================
// Tier 1: Fast Routing & Simple Response
// ============================================

/**
 * Use Tier 1 to analyze and route the request
 */
async function tier1Route(userMessage: string): Promise<RoutingDecision> {
  const startTime = Date.now();
  const tier1Model = SLM_MODELS.find((m) => m.tier === 1)!;

  try {
    const result = await callOllama(
      tier1Model.ollamaName,
      [
        { role: "system", content: TIER1_ROUTING_PROMPT },
        { role: "user", content: userMessage },
      ],
      {
        maxTokens: 256,
        temperature: 0.1, // Low temp for consistent routing
      },
    );

    // Parse JSON response
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
    console.log(`[SLM] Tier 1 routing: ${latency}ms, target: ${decision.target_llm}`);

    return {
      category: decision.category as RoutingDecision["category"],
      toolNeeded: decision.tool_needed === "none" ? null : decision.tool_needed,
      targetLLM: decision.target_llm as RoutingDecision["targetLLM"],
      confidence: decision.confidence,
      reason: decision.reason,
    };
  } catch (error) {
    // Fallback: treat as simple if routing fails
    console.warn("[SLM] Tier 1 routing failed, defaulting to tier1:", error);
    return {
      category: "simple",
      toolNeeded: null,
      targetLLM: "tier1",
      confidence: 0.5,
      reason: "routing fallback",
    };
  }
}

/**
 * Use Tier 1 for direct simple response
 */
async function tier1Respond(
  messages: SLMMessage[],
  options?: { maxTokens?: number; temperature?: number },
): Promise<SLMResponse> {
  const startTime = Date.now();
  const tier1Model = SLM_MODELS.find((m) => m.tier === 1)!;

  // Prepend system prompt
  const fullMessages: SLMMessage[] = [
    { role: "system", content: TIER1_RESPONSE_PROMPT },
    ...messages,
  ];

  const result = await callOllama(tier1Model.ollamaName, fullMessages, {
    maxTokens: options?.maxTokens ?? 1024,
    temperature: options?.temperature ?? 0.7,
  });

  return {
    content: result.content,
    model: tier1Model.ollamaName,
    tier: 1,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.promptTokens + result.completionTokens,
    },
    latencyMs: Date.now() - startTime,
  };
}

// ============================================
// Tier 2: Deep Reasoning (On-Demand)
// ============================================

/**
 * Use Tier 2 for complex offline processing
 */
async function tier2Process(
  messages: SLMMessage[],
  options?: { maxTokens?: number; temperature?: number; enableThinking?: boolean },
): Promise<SLMResponse> {
  const startTime = Date.now();
  const tier2Model = SLM_MODELS.find((m) => m.tier === 2)!;

  // Check if Tier 2 is available
  const status = await checkMoaSLMStatus();
  if (!status.tier2Ready) {
    throw new Error("Tier 2 model not available");
  }

  // Load model if not already loaded
  await loadModel(tier2Model.ollamaName);

  // Prepend system prompt with thinking mode
  const systemPrompt =
    options?.enableThinking !== false
      ? TIER2_REASONING_PROMPT
      : TIER2_REASONING_PROMPT.replace("/think", "/no_think");

  const fullMessages: SLMMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  const result = await callOllama(tier2Model.ollamaName, fullMessages, {
    maxTokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.7,
  });

  // Optionally unload after processing to free memory (mobile)
  // await unloadModel(tier2Model.ollamaName);

  return {
    content: result.content,
    thinking: result.thinking,
    model: tier2Model.ollamaName,
    tier: 2,
    usage: {
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.promptTokens + result.completionTokens,
    },
    latencyMs: Date.now() - startTime,
  };
}

// ============================================
// Main SLM Router
// ============================================

/**
 * Smart SLM routing with 2-tier architecture
 *
 * Flow:
 * 1. Ensure Ollama is running
 * 2. Tier 1 analyzes the request
 * 3. Based on analysis:
 *    - simple/medium → Tier 1 responds directly
 *    - complex (offline) → Tier 2 processes
 *    - complex (online) → Route to cloud
 *    - specialized → Route to specialized cloud LLM
 */
export async function routeSLM(
  userMessage: string,
  request: SLMRequest,
  options?: {
    forceLocal?: boolean; // Force local processing (offline mode)
    forceTier?: 1 | 2; // Force specific tier
    skipRouting?: boolean; // Skip routing, use Tier 1 directly
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
        };
      }
    }

    // Check SLM status
    const status = await checkMoaSLMStatus();
    if (!status.tier1Ready) {
      return {
        success: false,
        error: "에이전트 코어 모델이 설치되지 않았습니다",
        shouldRouteToCloud: true,
      };
    }

    // Force specific tier if requested
    if (options?.forceTier === 1 || options?.skipRouting) {
      const response = await tier1Respond(request.messages, {
        maxTokens: request.maxTokens,
        temperature: request.temperature,
      });
      return { success: true, response };
    }

    if (options?.forceTier === 2) {
      if (!status.tier2Ready) {
        return {
          success: false,
          error: "Tier 2 모델이 설치되지 않았습니다",
          shouldRouteToCloud: true,
        };
      }
      const response = await tier2Process(request.messages, {
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        enableThinking: request.enableThinking,
      });
      return { success: true, response };
    }

    // Step 1: Tier 1 routing analysis
    const routingDecision = await tier1Route(userMessage);

    // Step 2: Execute based on routing decision
    switch (routingDecision.targetLLM) {
      case "tier1": {
        const response = await tier1Respond(request.messages, {
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        });
        return { success: true, response, routingDecision };
      }

      case "tier2": {
        if (!status.tier2Ready) {
          // Tier 2 not available → route to cloud
          return {
            success: false,
            routingDecision,
            shouldRouteToCloud: true,
            cloudTarget: "cheap", // Use cheaper cloud model as fallback
          };
        }

        if (options?.forceLocal) {
          // Offline mode: use Tier 2
          const response = await tier2Process(request.messages, {
            maxTokens: request.maxTokens,
            temperature: request.temperature,
            enableThinking: request.enableThinking,
          });
          return { success: true, response, routingDecision };
        }

        // Online: prefer cloud for complex tasks (faster, better quality)
        return {
          success: false,
          routingDecision,
          shouldRouteToCloud: true,
          cloudTarget: "premium",
        };
      }

      case "cloud":
        return {
          success: false,
          routingDecision,
          shouldRouteToCloud: true,
          cloudTarget: routingDecision.category === "complex" ? "premium" : "cheap",
        };

      case "specialized":
        return {
          success: false,
          routingDecision,
          shouldRouteToCloud: true,
          cloudTarget: "specialized",
        };

      default:
        // Fallback to Tier 1
        const fallbackResponse = await tier1Respond(request.messages, {
          maxTokens: request.maxTokens,
          temperature: request.temperature,
        });
        return { success: true, response: fallbackResponse, routingDecision };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "SLM 처리 실패",
      shouldRouteToCloud: true,
    };
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if device should skip Tier 2 (low memory)
 */
export function shouldSkipTier2(): boolean {
  const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);
  // Skip Tier 2 if less than 6GB RAM
  return totalMemoryGB < 6;
}

/**
 * Get SLM info for display
 */
export async function getSLMInfo(): Promise<{
  tier1: { model: string; status: "ready" | "not-installed" | "loading" };
  tier2: { model: string; status: "ready" | "not-installed" | "loading" | "skipped" };
  serverRunning: boolean;
}> {
  const running = await isOllamaRunning();
  const status = running ? await checkMoaSLMStatus() : { tier1Ready: false, tier2Ready: false };

  const tier1Model = SLM_MODELS.find((m) => m.tier === 1)!;
  const tier2Model = SLM_MODELS.find((m) => m.tier === 2)!;

  return {
    tier1: {
      model: tier1Model.ollamaName,
      status: status.tier1Ready ? "ready" : "not-installed",
    },
    tier2: {
      model: tier2Model.ollamaName,
      status: shouldSkipTier2() ? "skipped" : status.tier2Ready ? "ready" : "not-installed",
    },
    serverRunning: running,
  };
}

/**
 * Preload Tier 2 model in background (for desktop)
 */
export async function preloadTier2(): Promise<boolean> {
  if (shouldSkipTier2()) {
    return false;
  }

  const status = await checkMoaSLMStatus();
  if (!status.tier2Ready) {
    return false;
  }

  const tier2Model = SLM_MODELS.find((m) => m.tier === 2)!;
  return loadModel(tier2Model.ollamaName);
}

/**
 * Unload Tier 2 to free memory (for mobile)
 */
export async function unloadTier2(): Promise<boolean> {
  const tier2Model = SLM_MODELS.find((m) => m.tier === 2)!;
  return unloadModel(tier2Model.ollamaName);
}

// Import os for memory check
import * as os from "os";
