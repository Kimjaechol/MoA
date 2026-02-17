/**
 * KakaoTalk SLM Module
 *
 * Re-exports core SLM functionality from src/slm/ (app-wide module)
 * and adds KakaoTalk-specific command handlers.
 *
 * Architecture:
 * - Core SLM (src/slm/): Ollama + Qwen3-0.6B gatekeeper + Gemini Flash fallback
 * - KakaoTalk handler (local): "MoA 설치", "AI 상태" commands for KakaoTalk users
 */

// ============================================
// Core SLM (re-exported from src/slm/)
// ============================================

// Ollama installer and model management
export {
  type SLMModel,
  type InstallProgress,
  type ProgressCallback,
  type OllamaStatus,
  type CloudStrategy,
  SLM_CORE_MODEL,
  CLOUD_FALLBACK_MODEL,
  CLOUD_FALLBACK_PROVIDER,
  CLOUD_MODELS,
  OLLAMA_API,
  isOllamaInstalled,
  getOllamaVersion,
  isOllamaRunning,
  startOllamaServer,
  installOllama,
  getInstalledModels,
  isModelInstalled,
  pullModel,
  deleteModel,
  getOllamaStatus,
  checkCoreModelStatus,
  installMoaSLM,
  healthCheck,
  autoRecover,
} from "../../../../src/slm/ollama-installer.js";

// SLM router
export {
  type SLMMessage,
  type SLMRequest,
  type SLMResponse,
  type RoutingDecision,
  type CloudDelegation,
  type SLMRouterResult,
  type QueuedCloudTask,
  classifyIntent,
  prepareDelegation,
  checkHeartbeatStatus,
  checkUserFollowUp,
  checkOfflineRecovery,
  resolveCloudModel,
  enqueueOfflineTask,
  dequeueOfflineTask,
  getOfflineQueue,
  clearOfflineQueue,
  routeSLM,
  getSLMInfo,
} from "../../../../src/slm/slm-router.js";

// MoA agent integration
export {
  type MoAAgentConfig,
  type MoAAgentStatus,
  type MoAInitResult,
  initializeMoAAgent,
  initializeMoAAgentBackground,
  getMoAAgentStatus,
  performHealthCheck,
  attemptRecovery,
  processThroughSLM,
  processHeartbeat,
  processFollowUpCheck,
  getDisplayInfo,
  formatProgressForDisplay,
} from "../../../../src/slm/moa-integration.js";

// Auto-installer
export {
  type AutoInstallConfig,
  type InstallStatus,
  type InstallStep,
  type InstallResult,
  type DeviceProfile,
  autoInstallSLM,
  detectDevice,
  formatInstallStatus,
  formatInstallResult,
} from "../../../../src/slm/auto-installer.js";

// Cloud dispatcher
export {
  type DelegationFile,
  type CloudDispatchResult,
  type CloudDispatcherConfig,
  writeDelegationFile,
  processCloudDelegation,
  processAllPendingDelegations,
  dispatchRecoveredTasks,
} from "../../../../src/slm/cloud-dispatcher.js";

// Offline monitor
export {
  type OfflineNotification,
  type OfflineMonitorConfig,
  type OfflineMonitorStatus,
  checkNetworkStatus,
  startOfflineMonitor,
  stopOfflineMonitor,
  getOfflineMonitorStatus,
  notifyOfflineTaskQueued,
  forceNetworkCheck,
} from "../../../../src/slm/offline-monitor.js";

// ============================================
// KakaoTalk-specific handler (local to extension)
// ============================================
export {
  type KakaoInstallSession,
  type SLMCommand,
  handleInstallCommand,
  handleInstallStart,
  handleStatusCommand,
  handleUninstallCommand,
  detectSLMCommand,
  handleSLMCommand,
  checkAndInstallOnStartup,
} from "./kakao-handler.js";
