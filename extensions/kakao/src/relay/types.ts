/**
 * MoA Remote Relay System - Type Definitions
 *
 * Enables users to control moltbot on remote devices via KakaoTalk.
 * The MoA server acts as a secure relay/message broker.
 */

// ============================================
// Device Types
// ============================================

export type DeviceType = "desktop" | "laptop" | "server" | "mobile" | "tablet" | "other";

/** Capabilities a device can advertise */
export type DeviceCapability =
  | "shell"
  | "file"
  | "browser"
  | "clipboard"
  | "screenshot"
  | "audio"
  | "notification";

export interface RelayDevice {
  id: string;
  userId: string;
  deviceToken: string;
  deviceName: string;
  deviceType: DeviceType;
  platform?: string;
  lastSeenAt: Date | null;
  isOnline: boolean;
  capabilities: DeviceCapability[];
  createdAt: Date;
}

export interface DeviceRegistration {
  deviceName: string;
  deviceType: DeviceType;
  platform?: string;
  capabilities?: DeviceCapability[];
}

// ============================================
// Pairing Types
// ============================================

export interface PairingCode {
  id: string;
  userId: string;
  code: string;
  expiresAt: Date;
  used: boolean;
}

export interface PairingResult {
  success: boolean;
  deviceToken?: string;
  deviceId?: string;
  userId?: string;
  error?: string;
}

/** Callbacks for relay lifecycle events */
export interface RelayCallbacks {
  /** Called when a device successfully completes pairing */
  onPairingComplete?: (params: {
    userId: string;
    deviceId: string;
    deviceName: string;
  }) => void | Promise<void>;

  /** Called when a device submits a command result (for immediate push to chat) */
  onResultReceived?: (params: {
    userId: string;
    deviceId: string;
    deviceName: string;
    commandId: string;
    status: "completed" | "failed";
    resultSummary: string;
  }) => void | Promise<void>;
}

// ============================================
// Command Types
// ============================================

export type CommandStatus =
  | "pending"
  | "awaiting_confirmation"
  | "delivered"
  | "executing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled";

/** Encrypted command stored in the database */
export interface RelayCommand {
  id: string;
  userId: string;
  targetDeviceId: string;
  encryptedCommand: string;
  iv: string;
  authTag: string;
  status: CommandStatus;
  priority: number;
  encryptedResult?: string;
  resultIv?: string;
  resultAuthTag?: string;
  resultSummary?: string;
  creditsCharged: number;
  createdAt: Date;
  deliveredAt?: Date;
  completedAt?: Date;
  expiresAt: Date;
}

/** Plaintext command payload (before encryption) */
export interface CommandPayload {
  type:
    | "shell"
    | "file_read"
    | "file_write"
    | "file_list"
    | "browser_open"
    | "clipboard"
    | "screenshot"
    | "custom";
  command: string;
  args?: Record<string, string>;
  /** Working directory for shell commands */
  cwd?: string;
  /** Max execution time in seconds (default: 60) */
  timeout?: number;
}

/** Plaintext result payload (before encryption) */
export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
  /** Exit code for shell commands */
  exitCode?: number;
  /** File content for file_read commands */
  data?: string;
  /** Execution duration in milliseconds */
  durationMs?: number;
}

// ============================================
// API Request/Response Types
// ============================================

/** POST /api/relay/pair - Complete device pairing */
export interface PairRequest {
  code: string;
  device: DeviceRegistration;
}

export interface PairResponse {
  success: boolean;
  deviceToken?: string;
  deviceId?: string;
  error?: string;
}

/** GET /api/relay/poll - Device polls for commands */
export interface PollResponse {
  commands: Array<{
    commandId: string;
    encryptedCommand: string;
    iv: string;
    authTag: string;
    priority: number;
    createdAt: string;
  }>;
}

/** POST /api/relay/result - Device submits result */
export interface ResultSubmission {
  commandId: string;
  encryptedResult: string;
  resultIv: string;
  resultAuthTag: string;
  resultSummary: string;
  status: "completed" | "failed";
}

export interface ResultResponse {
  success: boolean;
  error?: string;
}

/** POST /api/relay/heartbeat - Device heartbeat */
export interface HeartbeatResponse {
  ok: boolean;
  pendingCommands: number;
}

/** GET /api/relay/devices - List user's devices */
export interface DeviceListResponse {
  devices: Array<{
    id: string;
    deviceName: string;
    deviceType: DeviceType;
    platform?: string;
    isOnline: boolean;
    lastSeenAt: string | null;
    capabilities: DeviceCapability[];
  }>;
}

// ============================================
// Billing Types
// ============================================

export interface RelayBillingConfig {
  /** Credits per relay command (default: 10) */
  commandCost: number;
  /** Credits per result retrieval (default: 5) */
  resultCost: number;
  /** Free commands per day for premium users (default: 0) */
  freeCommandsPerDay: number;
  /** Max pending commands per user (default: 20) */
  maxPendingCommands: number;
  /** Max registered devices per user (default: 5) */
  maxDevicesPerUser: number;
}

export const DEFAULT_RELAY_BILLING: RelayBillingConfig = {
  commandCost: 10,
  resultCost: 0,
  freeCommandsPerDay: 0,
  maxPendingCommands: 20,
  maxDevicesPerUser: 5,
};

// ============================================
// Conversation Relay Types (Device-First)
// ============================================

/** The type of relay entry — command (legacy) or conversation (Device-First) or wipe (security) */
export type RelayEntryType = "command" | "conversation" | "wipe";

/** Conversation message relayed to the device for memory-augmented AI response */
export interface ConversationRelayPayload {
  type: "conversation";
  /** Original user message text */
  message: string;
  /** Channel the message came from (kakao, telegram, discord, etc.) */
  sourceChannel: string;
  /** User ID on the source channel */
  sourceUserId: string;
  /** Session/thread ID for context continuity */
  sessionId?: string;
  /** Category hint for semantic cache (daily, work, coding, etc.) */
  category?: string;
  /** Max response time in seconds before falling back (default: 10) */
  timeoutSec?: number;
}

/** Result from device after processing conversation with local memory */
export interface ConversationRelayResult {
  success: boolean;
  /** AI-generated response text */
  response?: string;
  /** Memory context that was used (for debugging/transparency) */
  memoryContext?: Array<{
    text: string;
    score: number;
    source: string;
  }>;
  /** New memories saved from this conversation */
  memoriesSaved?: number;
  /** Processing time on device in milliseconds */
  processingTimeMs?: number;
  error?: string;
}

// ============================================
// Response Strategy (Smart Degradation)
// ============================================

/** Which tier handled the response */
export type ResponseTier = "cache" | "device" | "fallback";

/** Degradation strategy result */
export interface ResponseStrategy {
  tier: ResponseTier;
  response: string;
  /** True if this response used user's personal memory */
  hasMemoryContext: boolean;
  /** Device that processed (if tier=device) */
  deviceName?: string;
  /** Cache similarity score (if tier=cache) */
  cacheScore?: number;
  processingTimeMs: number;
}

// ============================================
// Offline Queue Types
// ============================================

/** Message queued while all devices are offline */
export interface QueuedMessage {
  id: string;
  userId: string;
  message: string;
  sourceChannel: string;
  sourceUserId: string;
  sessionId?: string;
  category?: string;
  /** Priority: 0=normal, 1=high (e.g. urgent keyword detected) */
  priority: number;
  /** When the message was queued */
  queuedAt: string;
  /** When the message expires (default: 24 hours) */
  expiresAt: string;
  /** Status of the queued message */
  status: "queued" | "processing" | "delivered" | "expired";
}

// ============================================
// Device Security Types
// ============================================

/** Security configuration for a device */
export interface DeviceSecurityConfig {
  /** Unique hardware fingerprint for device binding */
  deviceFingerprint: string;
  /** Whether the local DB is encrypted at rest */
  dbEncryptedAtRest: boolean;
  /** Last time the DB encryption key was rotated */
  lastKeyRotation?: string;
  /** Whether chat history auto-purge is enabled */
  chatAutoPurge: boolean;
  /** Auto-purge interval in hours (default: 24) */
  chatPurgeIntervalHours: number;
}

/** Remote wipe command */
export interface WipeCommand {
  /** Target device ID to wipe */
  targetDeviceId: string;
  /** What to wipe */
  scope: "all" | "memory_db" | "chat_history" | "credentials";
  /** Who requested the wipe */
  requestedBy: string;
  /** Channel through which wipe was requested */
  requestChannel: string;
  /** When the wipe was requested */
  requestedAt: string;
  /** Whether the wipe was executed */
  executed: boolean;
  /** When the wipe was executed (null if pending) */
  executedAt?: string;
}

/** Device wipe status for reporting */
export interface WipeStatus {
  deviceId: string;
  deviceName: string;
  isOnline: boolean;
  pendingWipe: boolean;
  wipeScope?: WipeCommand["scope"];
  requestedAt?: string;
  executedAt?: string;
}

// ============================================
// Location Tracking Types (분실 기기 GPS 추적)
// ============================================

/** Heartbeat 응답에 포함되는 위치 추적 명령 */
export interface LocationTrackingCommand {
  /** GPS 추적 활성 여부 */
  tracking: boolean;
  /** 추적 세션 ID */
  sessionId?: string;
  /** GPS 수집 간격 (초) */
  intervalSec?: number;
  /** 고정밀 GPS 모드 */
  highAccuracy?: boolean;
}

/** 기기가 서버로 전송하는 위치 보고 */
export interface LocationReport {
  /** 위도 */
  latitude: number;
  /** 경도 */
  longitude: number;
  /** 정확도 (미터) */
  accuracy: number;
  /** 고도 (미터, 선택) */
  altitude?: number;
  /** 속도 (m/s, 선택) */
  speed?: number;
  /** 방향 (degrees, 선택) */
  bearing?: number;
  /** GPS 측정 시각 (ISO 8601) */
  measuredAt: string;
  /** 위치 제공자 */
  provider?: "gps" | "network" | "fused";
  /** 배터리 잔량 (%) */
  batteryLevel?: number;
  /** 네트워크 상태 */
  networkType?: "wifi" | "cellular" | "none";
  /** 이동 중 여부 */
  isMoving?: boolean;
}

/** 확장된 Heartbeat 응답 (위치 추적 포함) */
export interface ExtendedHeartbeatResponse extends HeartbeatResponse {
  /** 위치 추적 명령 (분실 모드일 때) */
  locationTracking?: LocationTrackingCommand;
}
