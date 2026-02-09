/**
 * Safety System — 작업 기록, 체크포인트, 되돌리기, 위험도 평가, 비상정지, 암호화 백업
 */
export {
  // Action Journal
  logAction,
  updateActionStatus,
  getRecentActions,
  getActionById,
  getUndoableActions,
  // Checkpoints
  createCheckpoint,
  getCheckpoints,
  getCheckpointById,
  // Memory Versioning
  getCurrentMemoryVersion,
  saveMemoryVersion,
  getMemoryVersion,
  getMemoryHistory,
  restoreMemoryToVersion,
  // Rollback
  undoAction,
  rollbackToCheckpoint,
  // Formatting
  formatActionHistory,
  formatCheckpointList,
  formatMemoryHistory,
  // Types
  type ActionEntry,
  type ActionType,
  type ActionStatus,
  type ReversibilityLevel,
  type UndoAction,
  type Checkpoint,
  type MemorySnapshot,
  type RollbackResult,
} from "./action-journal.js";

export {
  // Command Gravity
  assessCommandGravity,
  // Dead Man's Switch
  queueCommand,
  cancelPendingCommand,
  cancelAllPending,
  getPendingCommands,
  // Panic Button
  executePanic,
  releasePanicLock,
  isPanicLocked,
  // Guardian Angel
  guardianAngelCheck,
  // Formatting
  formatGravityAssessment,
  formatPendingCommands,
  // Types
  type GravityLevel,
  type GravityAssessment,
  type PendingCommand,
  type PanicResult,
} from "./command-gravity.js";

export {
  // Vault Operations
  initializeVault,
  isVaultInitialized,
  loadVaultMeta,
  createEncryptedBackup,
  restoreFromBackup,
  restoreWithRecoveryKey,
  // Recovery Key
  generateRecoveryKey,
  verifyRecoveryKey,
  createRecoveryBackup,
  // Retention Policy
  enforceRetentionPolicy,
  runScheduledBackup,
  // Device Local Key
  registerDeviceKey,
  getDeviceKey,
  storeDeviceEncryptedData,
  // Backup Info
  listBackups,
  getBackupStats,
  // Formatting
  formatBackupList,
  formatRecoveryKey,
  // Types
  type VaultMeta,
  type RetentionPolicy,
  type RecoveryKeyResult,
  type DeviceKeyRegistration,
  type BackupInfo,
} from "./encrypted-vault.js";
