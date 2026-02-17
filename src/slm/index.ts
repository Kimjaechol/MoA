/**
 * MoA Core SLM Module
 *
 * Single-tier architecture:
 * - Qwen3-0.6B (local, ~400MB): always-on gatekeeper
 *   -> intent classification, routing, heartbeat checks, privacy detection
 * - Gemini 2.0 Flash (cloud): all substantive processing
 *   -> reasoning, generation, analysis, translation, coding, etc.
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
  SLM_CORE_MODEL,
  CLOUD_FALLBACK_MODEL,
  CLOUD_FALLBACK_PROVIDER,
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
  type SLMRouterResult,
  classifyIntent,
  checkHeartbeatStatus,
  checkUserFollowUp,
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
