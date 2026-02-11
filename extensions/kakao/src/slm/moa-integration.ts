/**
 * MoA SLM Integration - Embedded Installation Flow
 *
 * This module integrates SLM installation into the MoA agent setup.
 * The installation happens silently in the background during agent initialization.
 *
 * Features:
 * - Silent background installation during first run
 * - Progress reporting for UI feedback
 * - Graceful degradation if installation fails
 * - Device-aware model selection (skip Tier 2 on low-memory devices)
 */

import {
  installMoaSLM,
  checkMoaSLMStatus,
  healthCheck,
  autoRecover,
  shouldSkipTier3Device,
  type InstallProgress,
  type ProgressCallback,
} from "./ollama-installer.js";
import {
  routeSLM,
  shouldSkipTier2,
  shouldSkipTier3,
  getSLMInfo,
  preloadTier2,
  preloadTier3,
  type SLMRequest,
  type SLMRouterResult,
} from "./slm-router.js";

// ============================================
// Types
// ============================================

export interface MoAAgentConfig {
  kakaoUserId: string;
  deviceType: "mobile" | "desktop" | "tablet";
  enableOfflineMode: boolean;
  enablePrivacyMode: boolean; // Force local processing for sensitive data
  skipTier2Install?: boolean;
  skipTier3Install?: boolean; // Skip Tier 3 for non-desktop (<16GB RAM)
}

export interface MoAAgentStatus {
  initialized: boolean;
  slmReady: boolean;
  tier1Available: boolean;
  tier2Available: boolean;
  tier3Available: boolean;
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
  tier1Available: false,
  tier2Available: false,
  tier3Available: false,
  offlineModeEnabled: false,
};

let initializationPromise: Promise<MoAInitResult> | null = null;

// ============================================
// Initialization
// ============================================

/**
 * Initialize MoA Agent with embedded SLM
 *
 * This should be called during agent first-run or app startup.
 * The installation happens in the background without blocking the UI.
 */
export async function initializeMoAAgent(
  config: MoAAgentConfig,
  onProgress?: ProgressCallback,
): Promise<MoAInitResult> {
  // Prevent concurrent initialization
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
    onProgress?.({
      phase: "checking",
      message: "MoA 에이전트 초기화 중...",
    });

    // Determine which tiers to skip based on device
    const skipTier2 =
      config.skipTier2Install ?? (config.deviceType === "mobile" || shouldSkipTier2());
    const skipTier3 =
      config.skipTier3Install ?? (config.deviceType !== "desktop" || shouldSkipTier3Device());

    // Install SLM models
    const installSuccess = await installMoaSLM(onProgress, {
      skipTier2,
      skipTier3,
    });

    if (!installSuccess) {
      // Installation failed, but we can still work with cloud
      agentStatus = {
        initialized: true,
        slmReady: false,
        tier1Available: false,
        tier2Available: false,
        tier3Available: false,
        offlineModeEnabled: false,
        error: "로컬 AI 설치 실패",
      };

      return {
        success: false,
        status: agentStatus,
        message: "로컬 AI 설치에 실패했습니다. 클라우드 AI를 사용합니다.",
      };
    }

    // Check final status
    const slmStatus = await checkMoaSLMStatus();

    // Preload advanced tiers for faster first response
    if (!skipTier2 && slmStatus.tier2Ready) {
      preloadTier2().catch(() => {});
    }
    if (!skipTier3 && slmStatus.tier3Ready) {
      preloadTier3().catch(() => {});
    }

    agentStatus = {
      initialized: true,
      slmReady: slmStatus.tier1Ready,
      tier1Available: slmStatus.tier1Ready,
      tier2Available: slmStatus.tier2Ready,
      tier3Available: slmStatus.tier3Ready,
      offlineModeEnabled: config.enableOfflineMode,
      lastHealthCheck: new Date(),
    };

    onProgress?.({
      phase: "ready",
      message: "MoA 에이전트 준비 완료",
    });

    const tierMsg = slmStatus.tier3Ready
      ? "Tier 1 + Tier 2 + Tier 3 (데스크탑 풀 모드)"
      : slmStatus.tier2Ready
        ? "Tier 1 + Tier 2 (모바일 모드)"
        : "Tier 1 전용";

    return {
      success: true,
      status: agentStatus,
      message: `MoA 에이전트가 준비되었습니다. (${tierMsg})`,
    };
  } catch (error) {
    agentStatus = {
      initialized: true,
      slmReady: false,
      tier1Available: false,
      tier2Available: false,
      tier3Available: false,
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
 *
 * Use this for silent installation that doesn't block the main flow.
 */
export function initializeMoAAgentBackground(
  config: MoAAgentConfig,
  onProgress?: ProgressCallback,
  onComplete?: (result: MoAInitResult) => void,
): void {
  initializeMoAAgent(config, onProgress)
    .then((result) => {
      onComplete?.(result);
    })
    .catch((error) => {
      onComplete?.({
        success: false,
        status: {
          initialized: false,
          slmReady: false,
          tier1Available: false,
          tier2Available: false,
          tier3Available: false,
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

/**
 * Get current agent status
 */
export function getMoAAgentStatus(): MoAAgentStatus {
  return { ...agentStatus };
}

/**
 * Perform health check and update status
 */
export async function performHealthCheck(): Promise<MoAAgentStatus> {
  const health = await healthCheck();

  agentStatus = {
    ...agentStatus,
    slmReady: health.healthy,
    tier1Available: health.tier1Loaded,
    tier2Available: health.tier2Available,
    tier3Available: health.tier3Available,
    lastHealthCheck: new Date(),
  };

  return agentStatus;
}

/**
 * Attempt to recover if SLM is not healthy
 */
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
 * Process message through MoA SLM
 *
 * This is the main entry point for local SLM processing.
 * It handles:
 * - Health check and auto-recovery
 * - Smart routing between Tier 1 and Tier 2
 * - Fallback to cloud when local fails
 */
export async function processThroughSLM(
  userMessage: string,
  request: SLMRequest,
  options?: {
    forceLocal?: boolean;
    forceTier?: 1 | 2 | 3;
  },
): Promise<SLMRouterResult> {
  // Check if initialized
  if (!agentStatus.initialized) {
    return {
      success: false,
      error: "MoA 에이전트가 초기화되지 않았습니다",
      shouldRouteToCloud: true,
    };
  }

  // Check SLM availability
  if (!agentStatus.slmReady) {
    // Attempt recovery
    const recovered = await attemptRecovery();
    if (!recovered) {
      return {
        success: false,
        error: "로컬 AI를 사용할 수 없습니다",
        shouldRouteToCloud: true,
      };
    }
  }

  // Route through SLM
  return routeSLM(userMessage, request, {
    forceLocal: options?.forceLocal ?? agentStatus.offlineModeEnabled,
    forceTier: options?.forceTier,
  });
}

// ============================================
// Utility
// ============================================

/**
 * Get human-readable SLM info for display
 */
export async function getDisplayInfo(): Promise<{
  status: string;
  tier1: string;
  tier2: string;
  tier3: string;
  recommendation: string;
}> {
  const info = await getSLMInfo();

  const statusEmoji = info.serverRunning ? "🟢" : "🔴";
  const formatTier = (t: { model: string; status: string }) => {
    const emoji = t.status === "ready" ? "✅" : t.status === "skipped" ? "⏭️" : "❌";
    const label =
      t.status === "ready" ? "준비됨" : t.status === "skipped" ? "건너뜀" : "미설치";
    return `${emoji} ${t.model} (${label})`;
  };

  return {
    status: `${statusEmoji} ${info.serverRunning ? "실행 중" : "정지됨"}`,
    tier1: formatTier(info.tier1),
    tier2: formatTier(info.tier2),
    tier3: formatTier(info.tier3),
    recommendation:
      info.tier1.status === "ready"
        ? "로컬 AI가 준비되어 개인정보 보호 및 오프라인 사용이 가능합니다."
        : "로컬 AI를 설치하면 개인정보를 외부로 전송하지 않고 처리할 수 있습니다.",
  };
}

/**
 * Format initialization progress for KakaoTalk message
 */
export function formatProgressForKakao(progress: InstallProgress): string {
  switch (progress.phase) {
    case "checking":
      return `🔍 ${progress.message}`;
    case "installing-ollama":
      return `⬇️ ${progress.message}`;
    case "pulling-model":
      if (progress.progress !== undefined) {
        const bar = createProgressBar(progress.progress);
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

function createProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

/**
 * Check if running in low-memory environment
 */
export function isLowMemoryEnvironment(): boolean {
  return shouldSkipTier2();
}

/**
 * Get recommended configuration based on device
 */
export function getRecommendedConfig(
  deviceType: "mobile" | "desktop" | "tablet",
): Partial<MoAAgentConfig> {
  switch (deviceType) {
    case "mobile":
      return {
        deviceType: "mobile",
        skipTier2Install: true, // Save storage on mobile
        enableOfflineMode: false, // Cloud preferred on mobile
        enablePrivacyMode: true, // Privacy important on mobile
      };
    case "tablet":
      return {
        deviceType: "tablet",
        skipTier2Install: shouldSkipTier2(),
        enableOfflineMode: false,
        enablePrivacyMode: true,
      };
    case "desktop":
      return {
        deviceType: "desktop",
        skipTier2Install: false,
        skipTier3Install: shouldSkipTier3Device(), // Tier 3 only if 16GB+ RAM
        enableOfflineMode: false,
        enablePrivacyMode: true,
      };
  }
}
