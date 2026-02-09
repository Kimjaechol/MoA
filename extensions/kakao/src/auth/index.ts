/**
 * Owner Authentication — barrel exports
 */
export {
  authenticateUser,
  isOwnerAuthEnabled,
  grantOwnerAuth,
  revokeOwnerAuth,
  getAuthenticatedOwners,
  getRequiredPermission,
  isGuestAllowed,
  sanitizeUserInput,
  wrapUserMessageForLLM,
  getSecuritySystemPrompt,
  getGuestDeniedResponse,
  type OwnerRole,
  type AuthResult,
  type OwnerOnlyAction,
  type GuestPermission,
} from "./owner-auth.js";

export {
  hasUserSecret,
  hasAnyUserSecret,
  getUserSecretCount,
  setUserSecret,
  verifyUserSecret,
  removeUserSecret,
  changeUserSecret,
  listUserSecrets,
  makeUserKey,
  type UserSecretEntry,
} from "./user-secrets.js";

export {
  signup,
  login,
  verifyPassword,
  findAccountByUsername,
  findAccountByChannel,
  linkChannel,
  hasAnyAccount,
  getAccountCount,
  getAccountDevices,
  removeAccountDevice,
  listAccounts,
  type UserAccount,
  type DeviceInfo,
  type SignupResult,
  type LoginResult,
} from "./user-accounts.js";

export {
  hasBackupPassword,
  setBackupPassword,
  verifyBackupPassword,
  resetBackupPasswordWithRecoveryKey,
  updateLastBackupTime,
  getBackupCredential,
  type BackupCredential,
} from "./backup-credentials.js";
