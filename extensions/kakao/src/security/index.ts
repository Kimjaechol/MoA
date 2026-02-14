/**
 * Security Module — Complete device security suite
 *
 * 5-Layer defense for lost/stolen devices:
 *
 * Layer 1: User Authentication (기존 구현)
 * Layer 2: Database Encryption at Rest (device-security.ts)
 * Layer 3: Device Binding — hardware fingerprint key derivation (device-security.ts)
 * Layer 4: Chat History Protection — ephemeral messages + masking (chat-history-guard.ts)
 * Layer 5: Remote Wipe — backup-then-wipe + lockdown (remote-wipe.ts + lost-device-handler.ts)
 */

// Device security (DB encryption, device binding, chat purge, secure wipe)
export {
  decryptDatabaseFile,
  deriveDbEncryptionKey,
  DeviceSecurityManager,
  encryptDatabaseFile,
  formatSecurityStatus,
  generateDeviceFingerprint,
} from "./device-security.js";

// Remote wipe (backup-then-wipe strategy)
export {
  cancelWipe,
  checkPendingWipe,
  formatWipeCompletionNotice,
  formatWipeConfirmation,
  formatWipeStatus,
  getWipeStatus,
  markWipeExecuted,
  requestRemoteWipe,
  updateWipeBackupStatus,
  type ExtendedWipeCommand,
  type WipeStrategy,
} from "./remote-wipe.js";

// Lost device handler (full orchestrator)
export {
  executeDeviceWipe,
  formatLostDeviceHelp,
  handleHeartbeatWipeCheck,
  reportLostDevice,
} from "./lost-device-handler.js";

// Chat history guard (ephemeral messages, masking, lockdown)
export {
  activateLockdown,
  deactivateLockdown,
  formatChatGuardStatus,
  isDeviceLocked,
  LOCKDOWN_MESSAGE,
  maskSensitiveData,
  processPendingDeletions,
  scheduleMessageDeletion,
  type ChatGuardConfig,
} from "./chat-history-guard.js";

// Platform security (OS-specific fingerprint, data paths, device detection)
export {
  collectPlatformFingerprint,
  detectPlatform,
  formatAllDeviceSecurityInfo,
  getDeviceDescription,
  resolvePlatformDataPaths,
  type PlatformDataPaths,
  type PlatformInfo,
} from "./platform-security.js";

// Re-export types
export type { DeviceSecurityConfig, WipeCommand, WipeStatus } from "../relay/types.js";
