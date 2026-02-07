/**
 * MoA SLM Module - 2-Tier Local AI Processing
 *
 * Provides:
 * - Automatic Ollama installation and model setup
 * - 2-Tier SLM architecture (Qwen3-0.6B + Qwen3-4B)
 * - Smart routing between local and cloud processing
 * - Privacy-preserving local processing for sensitive data
 */

// Ollama installer and model management
export {
  // Types
  type SLMModel,
  type InstallProgress,
  type ProgressCallback,
  type OllamaStatus,
  // Constants
  SLM_MODELS,
  // Ollama binary management
  isOllamaInstalled,
  getOllamaVersion,
  isOllamaRunning,
  startOllamaServer,
  installOllama,
  // Model management
  getInstalledModels,
  isModelInstalled,
  pullModel,
  deleteModel,
  // MoA SLM installation
  getOllamaStatus,
  checkMoaSLMStatus,
  installMoaSLM,
  healthCheck,
  autoRecover,
} from "./ollama-installer.js";

// SLM router for 2-tier processing
export {
  // Types
  type SLMMessage,
  type SLMRequest,
  type SLMResponse,
  type RoutingDecision,
  type SLMRouterResult,
  // Main router
  routeSLM,
  // Utility functions
  shouldSkipTier2,
  getSLMInfo,
  preloadTier2,
  unloadTier2,
} from "./slm-router.js";

// MoA agent integration
export {
  // Types
  type MoAAgentConfig,
  type MoAAgentStatus,
  type MoAInitResult,
  // Initialization
  initializeMoAAgent,
  initializeMoAAgentBackground,
  // Status
  getMoAAgentStatus,
  performHealthCheck,
  attemptRecovery,
  // Processing
  processThroughSLM,
  // Utility
  getDisplayInfo,
  formatProgressForKakao,
  isLowMemoryEnvironment,
  getRecommendedConfig,
} from "./moa-integration.js";

// Auto-installer (원클릭 자동 설치)
export {
  // Types
  type AutoInstallConfig,
  type InstallStatus,
  type InstallStep,
  type InstallResult,
  type DeviceProfile,
  // Main installer
  autoInstallSLM,
  // Device detection
  detectDevice,
  // Formatting
  formatInstallStatus,
  formatInstallStatusForKakao,
  formatInstallResult,
} from "./auto-installer.js";

// KakaoTalk handler (카카오톡 명령 처리)
export {
  // Types
  type KakaoInstallSession,
  type SLMCommand,
  // Command handlers
  handleInstallCommand,
  handleInstallStart,
  handleStatusCommand,
  handleUninstallCommand,
  // Intent detection
  detectSLMCommand,
  handleSLMCommand,
  // Startup
  checkAndInstallOnStartup,
} from "./kakao-handler.js";
