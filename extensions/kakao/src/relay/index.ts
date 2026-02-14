/**
 * 쌍둥이 MoA 직접 호출 시스템 (Twin MoA Direct Command System)
 *
 * 개념: 각 디바이스의 MoA는 독립된 개체이지만 기억(저장장치)을 공유하는 쌍둥이.
 * 사용자가 특정 디바이스(또는 여러 디바이스)를 직접 지정하여 MoA에게 명령.
 * 서버는 단순 메시지 브로커 역할만 수행 (AI 처리 없음).
 *
 * Architecture:
 *   사용자 (KakaoTalk) → MoA 서버 (메시지 브로커) → 대상 디바이스 MoA
 *                                    ↑
 *                              Supabase 명령 큐
 *
 * 장점:
 * - 낮은 지연시간 (중간 MoA 없이 직접 전달)
 * - 병렬 명령 가능 (여러 디바이스 동시 호출)
 * - 비용 절감 (AI 호출 1회만)
 * - 명확한 보안 (암호화된 메시지만 전달)
 *
 * Components:
 * - direct-command: Multi-device parallel commands & status
 * - device-auth: Device registration via pairing codes + token authentication
 * - relay-handler: Command routing, encryption, and result retrieval
 * - relay-billing: Credit-based billing for commands
 * - relay-server: HTTP API routes for device-side communication
 * - safety-guard: Dangerous command detection and confirmation flow
 */

// Direct command (multi-device support)
export {
  formatMultiDeviceResult,
  formatTwinMoAStatus,
  getTwinMoAStatus,
  parseDirectCommand,
  sendMultiDeviceCommand,
  type MultiDeviceResult,
  type ParsedDirectCommand,
  type TwinMoAStatus,
} from "./direct-command.js";

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
export { chargeRelayCommand, getRelayBillingConfig, getRelayUsageStats } from "./relay-billing.js";

// API server
export { handleRelayRequest } from "./relay-server.js";

// Device status monitoring
export {
  checkConnectionAlerts,
  formatDeviceStatusDetail,
  formatDeviceStatusSummary,
  getDetailedDeviceStatus,
  getDeviceActivityLog,
  getDeviceStatusById,
  getOnlineDevices,
  logDeviceActivity,
  type ConnectionAlert,
  type DeviceActivity,
  type DeviceStatus,
} from "./device-status.js";

// Conversation relay (Device-First Memory Engine)
export {
  relayConversationToDevice,
  routeConversation,
  selectBestDevice,
} from "./conversation-relay.js";

// Types
export type {
  CommandPayload,
  CommandResult,
  CommandStatus,
  ConversationRelayPayload,
  ConversationRelayResult,
  DeviceCapability,
  DeviceListResponse,
  DeviceRegistration,
  DeviceSecurityConfig,
  DeviceType,
  HeartbeatResponse,
  PairRequest,
  PairResponse,
  PairingCode,
  PairingResult,
  PollResponse,
  QueuedMessage,
  RelayBillingConfig,
  RelayCallbacks,
  RelayCommand,
  RelayDevice,
  RelayEntryType,
  ResponseStrategy,
  ResponseTier,
  ResultResponse,
  ResultSubmission,
  WipeCommand,
  WipeStatus,
} from "./types.js";

export { DEFAULT_RELAY_BILLING } from "./types.js";
