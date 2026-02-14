/**
 * Security Module
 *
 * Device security, encryption at rest, and remote wipe capabilities
 * for protecting user data on lost/stolen devices.
 */

// Device security (DB encryption, device binding, chat purge)
export {
  decryptDatabaseFile,
  deriveDbEncryptionKey,
  DeviceSecurityManager,
  encryptDatabaseFile,
  formatSecurityStatus,
  generateDeviceFingerprint,
} from "./device-security.js";

// Remote wipe
export {
  cancelWipe,
  checkPendingWipe,
  formatWipeConfirmation,
  formatWipeStatus,
  getWipeStatus,
  markWipeExecuted,
  requestRemoteWipe,
} from "./remote-wipe.js";

// Re-export types
export type { DeviceSecurityConfig, WipeCommand, WipeStatus } from "../relay/types.js";
