/**
 * Owner Authentication — barrel exports
 */
export {
  authenticateUser,
  isOwnerAuthEnabled,
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
