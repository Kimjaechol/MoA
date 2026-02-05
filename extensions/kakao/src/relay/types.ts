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
export type DeviceCapability = "shell" | "file" | "browser" | "clipboard" | "screenshot" | "audio" | "notification";

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
  error?: string;
}

// ============================================
// Command Types
// ============================================

export type CommandStatus = "pending" | "delivered" | "executing" | "completed" | "failed" | "expired" | "cancelled";

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
  type: "shell" | "file_read" | "file_write" | "file_list" | "browser_open" | "clipboard" | "screenshot" | "custom";
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
