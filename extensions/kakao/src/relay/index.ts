/**
 * MoA Remote Relay System
 *
 * Enables users to remotely control moltbot instances on other devices
 * via KakaoTalk through the MoA server.
 *
 * Architecture:
 *   Phone (KakaoTalk) → MoA Server (Railway) → Supabase Queue ← Target Device (moltbot)
 *
 * Components:
 * - device-auth: Device registration via pairing codes + token authentication
 * - relay-handler: Command routing, encryption, and result retrieval
 * - relay-billing: Credit-based billing for relay commands
 * - relay-server: HTTP API routes for device-side communication
 * - types: Shared type definitions
 */

// Device authentication & pairing
export {
  authenticateDevice,
  completePairing,
  findDeviceByName,
  generatePairingCode,
  listUserDevices,
  removeDevice,
  updateHeartbeat,
} from "./device-auth.js";

// Command handler
export {
  appendExecutionLog,
  cancelCommand,
  confirmCommand,
  decryptPayload,
  getCommandResult,
  getExecutionLog,
  getRecentCommands,
  parseCommandText,
  rejectCommand,
  sendRelayCommand,
  type SendRelayResult,
} from "./relay-handler.js";

// Safety guard
export {
  analyzeCommandSafety,
  formatSafetyWarning,
  type RiskLevel,
  type SafetyAnalysis,
} from "./safety-guard.js";

// Billing
export {
  chargeRelayCommand,
  getRelayBillingConfig,
  getRelayUsageStats,
} from "./relay-billing.js";

// API server
export { handleRelayRequest } from "./relay-server.js";

// Types
export type {
  CommandPayload,
  CommandResult,
  CommandStatus,
  DeviceCapability,
  DeviceListResponse,
  DeviceRegistration,
  DeviceType,
  HeartbeatResponse,
  PairRequest,
  PairResponse,
  PairingCode,
  PairingResult,
  PollResponse,
  RelayBillingConfig,
  RelayCommand,
  RelayDevice,
  ResultResponse,
  ResultSubmission,
} from "./types.js";

export { DEFAULT_RELAY_BILLING } from "./types.js";
