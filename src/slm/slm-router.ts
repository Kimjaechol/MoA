/**
 * SLM Router - Local Gatekeeper + Cloud Dispatch
 *
 * Architecture:
 * - Qwen3-0.6B (local, always-on): lightweight gatekeeper
 * - Cloud strategy:
 *   - 가성비 (cost_effective): Gemini 3.0 Flash
 *   - 최고성능 (max_performance): Claude Opus 4.6
 *
 * Qwen3-0.6B role (100% reliable at 0.6B parameter size):
 * 1. Intent classification → JSON { category, tool_needed, confidence }
 * 2. Greeting detection → direct simple response
 * 3. Heartbeat check → "are there pending tasks?" (yes/no)
 * 4. Privacy detection → flag sensitive data patterns
 * 5. Tool routing → which tool to call
 * 6. Cloud delegation → summarize context + task for cloud model
 *
 * Offline behavior:
 * - SLM still runs heartbeat, checks tasks, classifies intent
 * - If cloud is needed but offline → queue task locally, notify user
 * - On reconnect → auto-dispatch queued tasks to cloud
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  SLM_CORE_MODEL,
  CLOUD_FALLBACK_MODEL,
  CLOUD_FALLBACK_PROVIDER,
  CLOUD_MODELS,
  OLLAMA_API,
  isOllamaRunning,
  checkCoreModelStatus,
  autoRecover,
  type CloudStrategy,
} from "./ollama-installer.js";
import { writeDelegationFile } from "./cloud-dispatcher.js";

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

/** Delegation context SLM prepares for cloud model */
export interface CloudDelegation {
  contextSummary: string;
  taskDescription: string;
  suggestedUserQuestion: string;
}

export interface SLMRouterResult {
  success: boolean;
  response?: SLMResponse;
  routingDecision?: RoutingDecision;
  delegation?: CloudDelegation;
  error?: string;
  /** When true, caller should dispatch to cloud */
  shouldRouteToCloud?: boolean;
  cloudModel?: string;
  cloudProvider?: string;
  /** When true, task was queued for offline processing */
  queuedOffline?: boolean;
}

/** Queued task for offline → online recovery */
export interface QueuedCloudTask {
  id: string;
  userMessage: string;
  contextSummary: string;
  taskDescription: string;
  queuedAt: string;
  strategy: CloudStrategy;
}

// ============================================
// Offline Task Queue
// ============================================

const MOA_DATA_DIR = path.join(os.homedir(), ".moa");
const OFFLINE_QUEUE_PATH = path.join(MOA_DATA_DIR, "offline-queue.json");

function loadOfflineQueue(): QueuedCloudTask[] {
  try {
    if (fs.existsSync(OFFLINE_QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(OFFLINE_QUEUE_PATH, "utf-8")) as QueuedCloudTask[];
    }
  } catch {
    // ignore
  }
  return [];
}

function saveOfflineQueue(queue: QueuedCloudTask[]): void {
  try {
    if (!fs.existsSync(MOA_DATA_DIR)) {
      fs.mkdirSync(MOA_DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(OFFLINE_QUEUE_PATH, JSON.stringify(queue, null, 2));
  } catch (error) {
    console.warn("[SLM] Failed to save offline queue:", error);
  }
}

export function enqueueOfflineTask(task: Omit<QueuedCloudTask, "id" | "queuedAt">): string {
  const queue = loadOfflineQueue();
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  queue.push({
    ...task,
    id,
    queuedAt: new Date().toISOString(),
  });
  saveOfflineQueue(queue);
  return id;
}

export function getOfflineQueue(): QueuedCloudTask[] {
  return loadOfflineQueue();
}

export function dequeueOfflineTask(id: string): QueuedCloudTask | null {
  const queue = loadOfflineQueue();
  const index = queue.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const [task] = queue.splice(index, 1);
  saveOfflineQueue(queue);
  return task;
}

export function clearOfflineQueue(): void {
  saveOfflineQueue([]);
}

// ============================================
// Network Check
// ============================================

async function isOnline(): Promise<boolean> {
  try {
    const response = await fetch("https://www.google.com/generate_204", {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

// ============================================
// System Prompts (optimized for 0.6B model)
// ============================================

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

// SLM summarizes context for cloud delegation
const DELEGATION_PROMPT = `You are preparing a task delegation. Given the conversation, create a summary for a more capable AI.
Respond ONLY with JSON:

{
  "context_summary": "1-2 sentence summary of what the user discussed",
  "task_description": "what specific task needs to be done",
  "suggested_question": "a question to ask the user in Korean, like: 위 작업에 대해서 어떤 일을 도와드릴까요?"
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
 * Use Qwen3-0.6B to prepare delegation context for cloud model.
 *
 * SLM summarizes the conversation and task, so the cloud model
 * can ask the user: "위 작업에 대해서 어떤 일을 도와드릴까요?"
 */
export async function prepareDelegation(
  messages: SLMMessage[],
): Promise<CloudDelegation> {
  try {
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const result = await callOllama(
      SLM_CORE_MODEL.ollamaName,
      [
        { role: "system", content: DELEGATION_PROMPT },
        { role: "user", content: conversationText },
      ],
      { maxTokens: 256, temperature: 0.1 },
    );

    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse delegation");
    }

    const delegation = JSON.parse(jsonMatch[0]) as {
      context_summary: string;
      task_description: string;
      suggested_question: string;
    };

    return {
      contextSummary: delegation.context_summary,
      taskDescription: delegation.task_description,
      suggestedUserQuestion: delegation.suggested_question,
    };
  } catch {
    // Fallback: pass raw last message as context
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    return {
      contextSummary: lastUserMsg?.content ?? "",
      taskDescription: "사용자 요청 처리",
      suggestedUserQuestion: "위 작업에 대해서 어떤 일을 도와드릴까요?",
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
 * Works both online and offline. Reads task list and decides:
 * - No pending tasks → HEARTBEAT_OK
 * - Has pending tasks + online → call cloud for action
 * - Has pending tasks + offline → queue for later, notify user
 */
export async function checkHeartbeatStatus(taskContent: string): Promise<{
  hasPendingTasks: boolean;
  needsAttention: boolean;
  summary: string;
  shouldCallCloud: boolean;
  isOffline?: boolean;
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

    const needsCloud = status.has_pending_tasks && status.needs_attention;

    // If cloud is needed, check if we're online
    if (needsCloud) {
      const online = await isOnline();
      if (!online) {
        // Queue the task for when we're back online
        enqueueOfflineTask({
          userMessage: "",
          contextSummary: status.summary,
          taskDescription: `Heartbeat detected ${status.task_count} pending task(s)`,
          strategy: "cost_effective",
        });

        return {
          hasPendingTasks: status.has_pending_tasks,
          needsAttention: status.needs_attention,
          summary: status.summary,
          shouldCallCloud: false,
          isOffline: true,
        };
      }
    }

    return {
      hasPendingTasks: status.has_pending_tasks,
      needsAttention: status.needs_attention,
      summary: status.summary,
      shouldCallCloud: needsCloud,
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
      shouldCallCloud: decision.needs_follow_up,
    };
  } catch {
    return { needsFollowUp: false, reason: "check failed", shouldCallCloud: false };
  }
}

/**
 * Check if there are offline-queued tasks and we're back online.
 * Called during heartbeat to auto-dispatch.
 */
export async function checkOfflineRecovery(): Promise<{
  recovered: boolean;
  pendingTasks: QueuedCloudTask[];
}> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { recovered: false, pendingTasks: [] };
  }

  const online = await isOnline();
  if (!online) {
    return { recovered: false, pendingTasks: queue };
  }

  // We're back online with queued tasks
  return { recovered: true, pendingTasks: queue };
}

// ============================================
// Main SLM Router
// ============================================

/**
 * Resolve cloud model based on user's strategy
 */
export function resolveCloudModel(strategy: CloudStrategy = "cost_effective"): {
  model: string;
  provider: string;
} {
  return CLOUD_MODELS[strategy];
}

/**
 * Smart routing: Qwen3-0.6B classifies, then dispatches
 *
 * Flow:
 * 1. Ensure Ollama is running
 * 2. Qwen3-0.6B classifies intent
 * 3. Simple greetings → local response
 * 4. Complex tasks → prepare delegation context → route to cloud
 * 5. If offline → queue task, notify user
 */
export async function routeSLM(
  userMessage: string,
  request: SLMRequest,
  options?: {
    forceLocal?: boolean;
    skipRouting?: boolean;
    strategy?: CloudStrategy;
  },
): Promise<SLMRouterResult> {
  const strategy = options?.strategy ?? "cost_effective";
  const cloud = resolveCloudModel(strategy);

  try {
    // Ensure Ollama is running
    if (!(await isOllamaRunning())) {
      const recovered = await autoRecover();
      if (!recovered) {
        return {
          success: false,
          error: "로컬 AI 서버를 시작할 수 없습니다",
          shouldRouteToCloud: true,
          cloudModel: cloud.model,
          cloudProvider: cloud.provider,
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
        cloudModel: cloud.model,
        cloudProvider: cloud.provider,
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

    // Step 2: Simple → local response
    if (routingDecision.targetLLM === "local" && routingDecision.category === "simple") {
      const response = await respondLocally(request.messages, {
        maxTokens: request.maxTokens,
      });
      return { success: true, response, routingDecision };
    }

    // Step 3: Complex → prepare delegation context
    // SLM summarizes the conversation into a JSON structure that the
    // cloud model can use to understand what the user needs.
    const delegation = await prepareDelegation(request.messages);

    // Step 4: Check if online
    const online = await isOnline();
    if (!online) {
      // Offline: queue task for later dispatch
      const taskId = enqueueOfflineTask({
        userMessage,
        contextSummary: delegation.contextSummary,
        taskDescription: delegation.taskDescription,
        strategy,
      });

      console.log(`[SLM] Offline — queued task ${taskId} for cloud dispatch`);
      console.log(`[SLM] Task will be auto-dispatched when network recovers`);

      return {
        success: true,
        routingDecision,
        delegation,
        response: {
          content:
            `현재 인터넷에 연결되어 있지 않습니다.\n\n` +
            `📋 작업: ${delegation.taskDescription}\n` +
            `🤖 필요한 AI: ${cloud.model}\n\n` +
            `이 작업은 고급 AI(${cloud.model})가 필요하지만, ` +
            `현재 오프라인 상태입니다.\n\n` +
            `✅ 인터넷 연결이 복구되면 자동으로 처리하겠습니다.\n` +
            `📌 대기열에 등록되었습니다. (ID: ${taskId})`,
          model: SLM_CORE_MODEL.ollamaName,
          isLocal: true,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latencyMs: 0,
        },
        queuedOffline: true,
      };
    }

    // Step 5: Online → write delegation JSON file for MoA system to dispatch
    // The delegation file contains context_summary + task_description +
    // cloud_instruction that tells the cloud model what to do.
    const delegationId = writeDelegationFile(delegation, userMessage, strategy);
    console.log(`[SLM] Delegation file written: ${delegationId} → ${cloud.model}`);

    return {
      success: false,
      routingDecision,
      delegation,
      shouldRouteToCloud: true,
      cloudModel: cloud.model,
      cloudProvider: cloud.provider,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "SLM 처리 실패",
      shouldRouteToCloud: true,
      cloudModel: cloud.model,
      cloudProvider: cloud.provider,
    };
  }
}

// ============================================
// Utility Functions
// ============================================

export async function getSLMInfo(): Promise<{
  core: { model: string; status: "ready" | "not-installed" };
  cloudFallback: { model: string; provider: string };
  cloudStrategies: Record<CloudStrategy, { model: string; provider: string }>;
  serverRunning: boolean;
  offlineQueueSize: number;
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
    cloudStrategies: CLOUD_MODELS,
    serverRunning: running,
    offlineQueueSize: getOfflineQueue().length,
  };
}
