/**
 * MoA SLM Integration - Core Agent Integration Layer
 *
 * Connects the SLM (Qwen3-0.6B) + cloud AI architecture
 * to the MoA agent lifecycle: init, health check, processing.
 *
 * Architecture:
 * - Qwen3-0.6B: always-on gatekeeper (classification, routing, heartbeat)
 * - Cloud strategy:
 *   - 가성비: Gemini 3.0 Flash (cost-effective)
 *   - 최고성능: Claude Opus 4.6 (max performance)
 */

import {
  installMoaSLM,
  checkCoreModelStatus,
  healthCheck,
  autoRecover,
  CLOUD_FALLBACK_MODEL,
  CLOUD_FALLBACK_PROVIDER,
  CLOUD_MODELS,
  type CloudStrategy,
  type InstallProgress,
  type ProgressCallback,
} from "./ollama-installer.js";
import {
  routeSLM,
  getSLMInfo,
  checkHeartbeatStatus,
  checkUserFollowUp,
  checkOfflineRecovery,
  resolveCloudModel,
  type SLMRequest,
  type SLMRouterResult,
} from "./slm-router.js";
import {
  processAllPendingDelegations,
  dispatchRecoveredTasks,
  cleanupDelegationFiles,
  type CloudDispatcherConfig,
} from "./cloud-dispatcher.js";
import {
  startOfflineMonitor,
  stopOfflineMonitor,
  getOfflineMonitorStatus,
  notifyOfflineTaskQueued,
  type OfflineMonitorConfig,
} from "./offline-monitor.js";

// ============================================
// Types
// ============================================

export interface MoAAgentConfig {
  userId: string;
  enableOfflineMode: boolean;
  enablePrivacyMode: boolean;
  /** Cloud strategy: 가성비 (cost_effective) or 최고성능 (max_performance) */
  strategy?: CloudStrategy;
  /** API keys for cloud model dispatch */
  apiKeys?: { google?: string; anthropic?: string };
  /** Offline monitor configuration (popup/push/chat callbacks) */
  offlineMonitorConfig?: OfflineMonitorConfig;
}

export interface MoAAgentStatus {
  initialized: boolean;
  slmReady: boolean;
  coreAvailable: boolean;
  cloudFallbackModel: string;
  cloudFallbackProvider: string;
  strategy: CloudStrategy;
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
  strategy: "cost_effective",
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
 * Advanced tasks route to cloud based on strategy:
 * - 가성비: Gemini 3.0 Flash
 * - 최고성능: Claude Opus 4.6
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
  const strategy = config.strategy ?? "cost_effective";
  const cloud = resolveCloudModel(strategy);

  // Save API keys for heartbeat dispatch
  if (config.apiKeys) {
    savedApiKeys = config.apiKeys;
  }

  try {
    onProgress?.({ phase: "checking", message: "MoA 에이전트 초기화 중..." });

    // Install core model only (Tier 1, ~400MB)
    const installSuccess = await installMoaSLM(onProgress);

    if (!installSuccess) {
      agentStatus = {
        initialized: true,
        slmReady: false,
        coreAvailable: false,
        cloudFallbackModel: cloud.model,
        cloudFallbackProvider: cloud.provider,
        strategy,
        offlineModeEnabled: false,
        error: "로컬 AI 설치 실패",
      };

      return {
        success: false,
        status: agentStatus,
        message: `로컬 AI 설치에 실패했습니다. ${cloud.model}로 전체 처리합니다.`,
      };
    }

    const slmStatus = await checkCoreModelStatus();

    agentStatus = {
      initialized: true,
      slmReady: slmStatus.coreReady,
      coreAvailable: slmStatus.coreReady,
      cloudFallbackModel: cloud.model,
      cloudFallbackProvider: cloud.provider,
      strategy,
      offlineModeEnabled: config.enableOfflineMode,
      lastHealthCheck: new Date(),
    };

    onProgress?.({ phase: "ready", message: "MoA 에이전트 준비 완료" });

    // Start offline monitor for network detection + auto-recovery
    if (config.offlineMonitorConfig || config.apiKeys) {
      startOfflineMonitor({
        checkIntervalMs: 30_000,
        ...config.offlineMonitorConfig,
        apiKeys: config.apiKeys,
      });
      console.log("[MoA] Offline monitor started (30s interval)");
    }

    return {
      success: true,
      status: agentStatus,
      message: `MoA 에이전트가 준비되었습니다. (코어: Qwen3-0.6B + 클라우드: ${cloud.model})`,
    };
  } catch (error) {
    agentStatus = {
      initialized: true,
      slmReady: false,
      coreAvailable: false,
      cloudFallbackModel: cloud.model,
      cloudFallbackProvider: cloud.provider,
      strategy,
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
  const strategy = config.strategy ?? "cost_effective";
  const cloud = resolveCloudModel(strategy);

  initializeMoAAgent(config, onProgress)
    .then((result) => onComplete?.(result))
    .catch((error) => {
      onComplete?.({
        success: false,
        status: {
          initialized: false,
          slmReady: false,
          coreAvailable: false,
          cloudFallbackModel: cloud.model,
          cloudFallbackProvider: cloud.provider,
          strategy,
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
 * 3. Everything else → shouldRouteToCloud=true (caller uses cloud based on strategy)
 */
export async function processThroughSLM(
  userMessage: string,
  request: SLMRequest,
  options?: {
    forceLocal?: boolean;
    strategy?: CloudStrategy;
  },
): Promise<SLMRouterResult> {
  const strategy = options?.strategy ?? agentStatus.strategy;
  const cloud = resolveCloudModel(strategy);

  if (!agentStatus.initialized) {
    return {
      success: false,
      error: "MoA 에이전트가 초기화되지 않았습니다",
      shouldRouteToCloud: true,
      cloudModel: cloud.model,
      cloudProvider: cloud.provider,
    };
  }

  if (!agentStatus.slmReady) {
    const recovered = await attemptRecovery();
    if (!recovered) {
      return {
        success: false,
        error: "로컬 AI를 사용할 수 없습니다",
        shouldRouteToCloud: true,
        cloudModel: cloud.model,
        cloudProvider: cloud.provider,
      };
    }
  }

  return routeSLM(userMessage, request, {
    forceLocal: options?.forceLocal ?? agentStatus.offlineModeEnabled,
    strategy,
  });
}

/**
 * Heartbeat processing via Qwen3-0.6B
 *
 * Reads task status and decides:
 * - No pending tasks → HEARTBEAT_OK (no cloud call needed)
 * - Has tasks + online → shouldCallCloud=true (cloud handles action)
 * - Has tasks + offline → queue for later, notify user
 *
 * Also:
 * - Checks for offline recovery (queued tasks + back online → auto-dispatch)
 * - Dispatches pending delegation files to cloud API
 * - Cleans up old delegation files (24h+)
 */
export async function processHeartbeat(
  taskContent: string,
  apiKeys?: { google?: string; anthropic?: string },
  dispatchConfig?: CloudDispatcherConfig,
): Promise<{
  shouldCallCloud: boolean;
  summary: string;
  needsAttention: boolean;
  offlineRecovery?: { recovered: boolean; pendingCount: number };
  cloudDispatched?: { processed: number; failed: number };
}> {
  const keys = apiKeys ?? savedApiKeys;

  // Check for offline recovery (queued tasks + back online)
  const recovery = await checkOfflineRecovery();
  const offlineRecovery = recovery.pendingTasks.length > 0
    ? { recovered: recovery.recovered, pendingCount: recovery.pendingTasks.length }
    : undefined;

  // If recovered from offline, dispatch queued tasks (auto-deduplicates)
  if (recovery.recovered && recovery.pendingTasks.length > 0 && keys) {
    try {
      const dispatched = await dispatchRecoveredTasks(
        recovery.pendingTasks,
        keys,
        dispatchConfig,
      );
      console.log(
        `[MoA] Heartbeat: dispatched ${dispatched.dispatched} recovered tasks` +
        (dispatched.deduplicatedFrom > dispatched.dispatched + dispatched.failed
          ? ` (deduplicated from ${dispatched.deduplicatedFrom})`
          : ""),
      );
    } catch (error) {
      console.warn("[MoA] Heartbeat: failed to dispatch recovered tasks:", error);
    }
  }

  // Dispatch any pending delegation files (from routeSLM)
  let cloudDispatched: { processed: number; failed: number } | undefined;
  if (keys) {
    try {
      cloudDispatched = await processAllPendingDelegations(keys, dispatchConfig);
      if (cloudDispatched.processed > 0) {
        console.log(
          `[MoA] Heartbeat: dispatched ${cloudDispatched.processed} delegation(s)`,
        );
      }
    } catch (error) {
      console.warn("[MoA] Heartbeat: delegation dispatch failed:", error);
    }
  }

  // Periodic cleanup of old delegation files
  cleanupDelegationFiles();

  if (!agentStatus.slmReady) {
    return {
      shouldCallCloud: true,
      summary: "SLM unavailable",
      needsAttention: false,
      offlineRecovery,
      cloudDispatched,
    };
  }

  const result = await checkHeartbeatStatus(taskContent);
  return { ...result, offlineRecovery, cloudDispatched };
}

// Store API keys from initialization for use in heartbeat
let savedApiKeys: { google?: string; anthropic?: string } | null = null;

/**
 * User follow-up check via Qwen3-0.6B
 *
 * After interval, checks if user needs prompting.
 * If yes → cloud model generates the follow-up message.
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
  strategy: string;
  offlineQueue: string;
  networkMonitor: string;
  recommendation: string;
}> {
  const info = await getSLMInfo();
  const monitorStatus = getOfflineMonitorStatus();

  const statusEmoji = info.serverRunning ? "🟢" : "🔴";
  const coreEmoji = info.core.status === "ready" ? "✅" : "❌";
  const coreLabel = info.core.status === "ready" ? "준비됨" : "미설치";

  const strategyLabel = agentStatus.strategy === "max_performance"
    ? "최고성능 (Claude Opus 4.6)"
    : "가성비 (Gemini 3.0 Flash)";

  const queueLabel = info.offlineQueueSize > 0
    ? `📋 대기 중인 작업: ${info.offlineQueueSize}건`
    : "없음";

  const networkLabel = monitorStatus.isMonitoring
    ? `${monitorStatus.isOnline ? "🌐 온라인" : "📴 오프라인"} (${monitorStatus.checkIntervalMs / 1000}초 간격 모니터링)`
    : "모니터 비활성";

  return {
    status: `${statusEmoji} ${info.serverRunning ? "실행 중" : "정지됨"}`,
    core: `${coreEmoji} ${info.core.model} (${coreLabel}) - 의도분류/라우팅/하트비트`,
    cloudFallback: `☁️ ${info.cloudFallback.model} (${info.cloudFallback.provider}) - 추론/생성/분석`,
    strategy: `🎯 ${strategyLabel}`,
    offlineQueue: queueLabel,
    networkMonitor: networkLabel,
    recommendation:
      info.core.status === "ready"
        ? `로컬 게이트키퍼 + 클라우드 AI 연동 모드로 동작 중입니다. (${strategyLabel})`
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
