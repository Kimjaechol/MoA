/**
 * MoA Core SLM Module
 *
 * Single-tier architecture:
 * - Qwen3-0.6B (local, ~400MB): always-on gatekeeper
 *   -> intent classification, routing, heartbeat checks, privacy detection
 * - Cloud strategy:
 *   -> 가성비: Gemini 3.0 Flash (cost-effective)
 *   -> 최고성능: Claude Opus 4.6 (max performance)
 *
 * This is the app-wide SLM module. Extensions (e.g., kakao) should
 * import from here for core SLM functionality.
 */

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
} from "./ollama-installer.js";

// SLM router (local gatekeeper + cloud dispatch)
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
} from "./slm-router.js";

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
} from "./moa-integration.js";

// Auto-installer (one-click setup)
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
} from "./auto-installer.js";

// Cloud dispatcher (SLM → JSON → Cloud API pipeline)
export {
  type DelegationFile,
  type CloudDispatchResult,
  type CloudDispatcherConfig,
  writeDelegationFile,
  readDelegationFile,
  getPendingDelegations,
  cleanupDelegationFiles,
  dispatchToCloud,
  processCloudDelegation,
  processAllPendingDelegations,
  dispatchRecoveredTasks,
} from "./cloud-dispatcher.js";

// Offline monitor (network detection + notifications + auto-recovery)
export {
  type NotificationChannel,
  type OfflineNotification,
  type OfflineMonitorConfig,
  type OfflineMonitorStatus,
  checkNetworkStatus,
  getNetworkInterfaces,
  startOfflineMonitor,
  stopOfflineMonitor,
  getOfflineMonitorStatus,
  notifyOfflineTaskQueued,
  forceNetworkCheck,
} from "./offline-monitor.js";
