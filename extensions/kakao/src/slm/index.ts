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
