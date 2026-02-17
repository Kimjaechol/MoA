/**
 * MoA SLM Integration - Core Agent Integration Layer
 *
 * Connects the SLM (Qwen3-0.6B) + Gemini Flash architecture
 * to the MoA agent lifecycle: init, health check, processing.
 *
 * Architecture:
 * - Qwen3-0.6B: always-on gatekeeper (classification, routing, heartbeat)
 * - Gemini 2.0 Flash: all substantive processing (reasoning, generation, etc.)
 */

import {
  installMoaSLM,
  checkCoreModelStatus,
  healthCheck,
  autoRecover,
  CLOUD_FALLBACK_MODEL,
  CLOUD_FALLBACK_PROVIDER,
  type InstallProgress,
  type ProgressCallback,
} from "./ollama-installer.js";
import {
  routeSLM,
  getSLMInfo,
  checkHeartbeatStatus,
  checkUserFollowUp,
  type SLMRequest,
  type SLMRouterResult,
} from "./slm-router.js";

// ============================================
// Types
// ============================================

export interface MoAAgentConfig {
  userId: string;
  enableOfflineMode: boolean;
  enablePrivacyMode: boolean;
}

export interface MoAAgentStatus {
  initialized: boolean;
  slmReady: boolean;
  coreAvailable: boolean;
  cloudFallbackModel: string;
  cloudFallbackProvider: string;
  offlineModeEnabled: boolean;
  lastHealthCheck?: Date;
  error?: string;
}

export interface MoAInitResult {
  success: boolean;
  status: MoAAgentStatus;
  message: string;
}

// ============================================
// State
// ============================================

let agentStatus: MoAAgentStatus = {
  initialized: false,
  slmReady: false,
  coreAvailable: false,
  cloudFallbackModel: CLOUD_FALLBACK_MODEL,
  cloudFallbackProvider: CLOUD_FALLBACK_PROVIDER,
  offlineModeEnabled: false,
};

let initializationPromise: Promise<MoAInitResult> | null = null;

// ============================================
// Initialization
// ============================================

/**
 * Initialize MoA Agent with core SLM
 *
 * Installs only Qwen3-0.6B (~400MB).
 * All advanced tasks route to Gemini 2.0 Flash.
 */
export async function initializeMoAAgent(
  config: MoAAgentConfig,
  onProgress?: ProgressCallback,
): Promise<MoAInitResult> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = doInitialize(config, onProgress);
  const result = await initializationPromise;
  initializationPromise = null;
  return result;
}

async function doInitialize(
  config: MoAAgentConfig,
  onProgress?: ProgressCallback,
): Promise<MoAInitResult> {
  try {
    onProgress?.({ phase: "checking", message: "MoA 에이전트 초기화 중..." });

    // Install core model only (Tier 1, ~400MB)
    const installSuccess = await installMoaSLM(onProgress);

    if (!installSuccess) {
      agentStatus = {
        initialized: true,
        slmReady: false,
        coreAvailable: false,
        cloudFallbackModel: CLOUD_FALLBACK_MODEL,
        cloudFallbackProvider: CLOUD_FALLBACK_PROVIDER,
        offlineModeEnabled: false,
        error: "로컬 AI 설치 실패",
      };

      return {
        success: false,
        status: agentStatus,
        message: "로컬 AI 설치에 실패했습니다. Gemini Flash로 전체 처리합니다.",
      };
    }

    const slmStatus = await checkCoreModelStatus();

    agentStatus = {
      initialized: true,
      slmReady: slmStatus.coreReady,
      coreAvailable: slmStatus.coreReady,
      cloudFallbackModel: CLOUD_FALLBACK_MODEL,
      cloudFallbackProvider: CLOUD_FALLBACK_PROVIDER,
      offlineModeEnabled: config.enableOfflineMode,
      lastHealthCheck: new Date(),
    };

    onProgress?.({ phase: "ready", message: "MoA 에이전트 준비 완료" });

    return {
      success: true,
      status: agentStatus,
      message: `MoA 에이전트가 준비되었습니다. (코어: Qwen3-0.6B + 클라우드: ${CLOUD_FALLBACK_MODEL})`,
    };
  } catch (error) {
    agentStatus = {
      initialized: true,
      slmReady: false,
      coreAvailable: false,
      cloudFallbackModel: CLOUD_FALLBACK_MODEL,
      cloudFallbackProvider: CLOUD_FALLBACK_PROVIDER,
      offlineModeEnabled: false,
      error: error instanceof Error ? error.message : "초기화 실패",
    };

    return {
      success: false,
      status: agentStatus,
      message: "MoA 에이전트 초기화에 실패했습니다.",
    };
  }
}

/**
 * Background initialization (non-blocking)
 */
export function initializeMoAAgentBackground(
  config: MoAAgentConfig,
  onProgress?: ProgressCallback,
  onComplete?: (result: MoAInitResult) => void,
): void {
  initializeMoAAgent(config, onProgress)
    .then((result) => onComplete?.(result))
    .catch((error) => {
      onComplete?.({
        success: false,
        status: {
          initialized: false,
          slmReady: false,
          coreAvailable: false,
          cloudFallbackModel: CLOUD_FALLBACK_MODEL,
          cloudFallbackProvider: CLOUD_FALLBACK_PROVIDER,
          offlineModeEnabled: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        message: "백그라운드 초기화 실패",
      });
    });
}

// ============================================
// Agent Status
// ============================================

export function getMoAAgentStatus(): MoAAgentStatus {
  return { ...agentStatus };
}

export async function performHealthCheck(): Promise<MoAAgentStatus> {
  const health = await healthCheck();

  agentStatus = {
    ...agentStatus,
    slmReady: health.healthy,
    coreAvailable: health.coreLoaded,
    lastHealthCheck: new Date(),
  };

  return agentStatus;
}

export async function attemptRecovery(): Promise<boolean> {
  const recovered = await autoRecover();
  if (recovered) {
    await performHealthCheck();
  }
  return recovered;
}

// ============================================
// Processing
// ============================================

/**
 * Process message through MoA SLM pipeline
 *
 * 1. Qwen3-0.6B classifies intent
 * 2. Simple → local response
 * 3. Everything else → shouldRouteToCloud=true (caller uses Gemini Flash)
 */
export async function processThroughSLM(
  userMessage: string,
  request: SLMRequest,
  options?: {
    forceLocal?: boolean;
  },
): Promise<SLMRouterResult> {
  if (!agentStatus.initialized) {
    return {
      success: false,
      error: "MoA 에이전트가 초기화되지 않았습니다",
      shouldRouteToCloud: true,
      cloudModel: CLOUD_FALLBACK_MODEL,
      cloudProvider: CLOUD_FALLBACK_PROVIDER,
    };
  }

  if (!agentStatus.slmReady) {
    const recovered = await attemptRecovery();
    if (!recovered) {
      return {
        success: false,
        error: "로컬 AI를 사용할 수 없습니다",
        shouldRouteToCloud: true,
        cloudModel: CLOUD_FALLBACK_MODEL,
        cloudProvider: CLOUD_FALLBACK_PROVIDER,
      };
    }
  }

  return routeSLM(userMessage, request, {
    forceLocal: options?.forceLocal ?? agentStatus.offlineModeEnabled,
  });
}

/**
 * Heartbeat processing via Qwen3-0.6B
 *
 * Reads task status and decides:
 * - No tasks → HEARTBEAT_OK (no cloud call needed)
 * - Has tasks → shouldCallCloud=true (Gemini Flash handles action)
 */
export async function processHeartbeat(taskContent: string): Promise<{
  shouldCallCloud: boolean;
  summary: string;
  needsAttention: boolean;
}> {
  if (!agentStatus.slmReady) {
    // If local SLM unavailable, let cloud handle everything
    return { shouldCallCloud: true, summary: "SLM unavailable", needsAttention: false };
  }

  return checkHeartbeatStatus(taskContent);
}

/**
 * User follow-up check via Qwen3-0.6B
 *
 * After interval, checks if user needs prompting.
 * If yes → Gemini Flash generates the follow-up message.
 */
export async function processFollowUpCheck(lastContext: string): Promise<{
  shouldCallCloud: boolean;
  reason: string;
}> {
  if (!agentStatus.slmReady) {
    return { shouldCallCloud: false, reason: "SLM unavailable" };
  }

  const result = await checkUserFollowUp(lastContext);
  return {
    shouldCallCloud: result.shouldCallCloud,
    reason: result.reason,
  };
}

// ============================================
// Utility
// ============================================

export async function getDisplayInfo(): Promise<{
  status: string;
  core: string;
  cloudFallback: string;
  recommendation: string;
}> {
  const info = await getSLMInfo();

  const statusEmoji = info.serverRunning ? "🟢" : "🔴";
  const coreEmoji = info.core.status === "ready" ? "✅" : "❌";
  const coreLabel = info.core.status === "ready" ? "준비됨" : "미설치";

  return {
    status: `${statusEmoji} ${info.serverRunning ? "실행 중" : "정지됨"}`,
    core: `${coreEmoji} ${info.core.model} (${coreLabel}) - 의도분류/라우팅/하트비트`,
    cloudFallback: `☁️ ${info.cloudFallback.model} (${info.cloudFallback.provider}) - 추론/생성/분석`,
    recommendation:
      info.core.status === "ready"
        ? "로컬 게이트키퍼 + Gemini Flash 연동 모드로 동작 중입니다."
        : "로컬 AI를 설치하면 빠른 의도분류와 프라이버시 보호가 가능합니다.",
  };
}

export function formatProgressForDisplay(progress: InstallProgress): string {
  switch (progress.phase) {
    case "checking":
      return `🔍 ${progress.message}`;
    case "installing-ollama":
      return `⬇️ ${progress.message}`;
    case "pulling-model":
      if (progress.progress !== undefined) {
        const filled = Math.round(progress.progress / 10);
        const empty = 10 - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        return `📦 ${progress.model}\n${bar} ${progress.progress}%`;
      }
      return `📦 ${progress.message}`;
    case "ready":
      return `✅ ${progress.message}`;
    case "error":
      return `❌ ${progress.message}\n${progress.error || ""}`;
    default:
      return progress.message;
  }
}
