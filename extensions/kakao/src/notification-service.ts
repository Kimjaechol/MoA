/**
 * MoA Notification Service
 *
 * High-level notification service that sends AlimTalk (알림톡) and
 * FriendTalk (친구톡) messages to users via NHN Cloud Toast API.
 *
 * AlimTalk: Template-based notifications (requires pre-registered templates)
 * FriendTalk: Free-form messages (only to channel friends)
 *
 * Usage:
 *   const notifier = createNotificationService(account);
 *   await notifier.notifyDevicePaired(phoneNumber, "노트북");
 *   await notifier.notifyCommandResult(phoneNumber, { ... });
 */

import type { ResolvedKakaoAccount } from "./types.js";
import { createKakaoApiClient } from "./api-client.js";
import {
  getAlimTalkTemplate,
  validateTemplateParams,
  type AlimTalkTemplate,
} from "./alimtalk-templates.js";

export interface NotificationResult {
  success: boolean;
  method: "alimtalk" | "friendtalk" | "none";
  error?: string;
  requestId?: string;
}

export interface NotificationService {
  /** Check if notification service is available */
  isConfigured(): boolean;

  /** Send device pairing notification */
  notifyDevicePaired(recipientNo: string, deviceName: string): Promise<NotificationResult>;

  /** Send command execution result notification */
  notifyCommandResult(
    recipientNo: string,
    params: {
      deviceName: string;
      commandText: string;
      status: string;
      resultSummary: string;
      commandId: string;
    },
  ): Promise<NotificationResult>;

  /** Send device offline notification */
  notifyDeviceOffline(
    recipientNo: string,
    deviceName: string,
    lastSeenAt: string,
  ): Promise<NotificationResult>;

  /** Send security alert */
  notifySecurityAlert(
    recipientNo: string,
    alertType: string,
    alertMessage: string,
  ): Promise<NotificationResult>;

  /** Send backup complete notification */
  notifyBackupComplete(
    recipientNo: string,
    backupType: string,
    backupSize: string,
  ): Promise<NotificationResult>;

  /** Send welcome message after signup */
  notifyWelcome(recipientNo: string, username: string): Promise<NotificationResult>;

  /** Send generic AlimTalk by template code */
  sendAlimTalk(
    recipientNo: string,
    templateCode: string,
    params: Record<string, string>,
  ): Promise<NotificationResult>;

  /** Send generic FriendTalk (free-form message) */
  sendFriendTalk(recipientNo: string, content: string): Promise<NotificationResult>;
}

/**
 * Create a notification service for a Kakao account
 */
export function createNotificationService(account: ResolvedKakaoAccount): NotificationService {
  const apiClient = createKakaoApiClient(account);
  const configured = !!(account.toastAppKey && account.toastSecretKey && account.senderKey);

  return {
    isConfigured: () => configured,

    async notifyDevicePaired(recipientNo, deviceName) {
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, "moa_device_paired", {
        deviceName,
      });
    },

    async notifyCommandResult(recipientNo, params) {
      // Truncate long values for template variable length limits
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, "moa_command_result", {
        deviceName: params.deviceName,
        commandText: truncate(params.commandText, 50),
        status: params.status,
        resultSummary: truncate(params.resultSummary, 100),
        commandId: params.commandId.slice(0, 8),
      });
    },

    async notifyDeviceOffline(recipientNo, deviceName, lastSeenAt) {
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, "moa_device_offline", {
        deviceName,
        lastSeenAt,
      });
    },

    async notifySecurityAlert(recipientNo, alertType, alertMessage) {
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, "moa_security_alert", {
        alertType,
        alertMessage: truncate(alertMessage, 100),
        timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      });
    },

    async notifyBackupComplete(recipientNo, backupType, backupSize) {
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, "moa_backup_complete", {
        backupType,
        backupSize,
        timestamp: new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }),
      });
    },

    async notifyWelcome(recipientNo, username) {
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, "moa_welcome", {
        username,
      });
    },

    async sendAlimTalk(recipientNo, templateCode, params) {
      return sendAlimTalkWithFallback(apiClient, account, recipientNo, templateCode, params);
    },

    async sendFriendTalk(recipientNo, content) {
      if (!configured) {
        return { success: false, method: "none" as const, error: "Notification service not configured" };
      }

      const result = await apiClient.sendFriendTalk({ recipientNo, content });
      return {
        success: result.success,
        method: "friendtalk" as const,
        error: result.error,
        requestId: result.requestId,
      };
    },
  };
}

/**
 * Send AlimTalk with FriendTalk fallback
 *
 * Tries AlimTalk first (template-based, works for non-friends too).
 * Falls back to FriendTalk (free-form, friends only) if AlimTalk fails.
 */
async function sendAlimTalkWithFallback(
  apiClient: ReturnType<typeof createKakaoApiClient>,
  account: ResolvedKakaoAccount,
  recipientNo: string,
  templateCode: string,
  params: Record<string, string>,
): Promise<NotificationResult> {
  if (!account.toastAppKey || !account.toastSecretKey || !account.senderKey) {
    return { success: false, method: "none", error: "Notification service not configured" };
  }

  // Validate template params
  const validation = validateTemplateParams(templateCode, params);
  if (!validation.valid) {
    console.warn(
      `[notification] Template "${templateCode}" missing params: ${validation.missing.join(", ")}`,
    );
  }

  // Try AlimTalk first
  const alimResult = await apiClient.sendAlimTalk({
    recipientNo,
    templateCode,
    templateParameter: params,
  });

  if (alimResult.success) {
    console.log(`[notification] AlimTalk "${templateCode}" sent to ${recipientNo.slice(0, 7)}***`);
    return {
      success: true,
      method: "alimtalk",
      requestId: alimResult.requestId,
    };
  }

  // AlimTalk failed — fall back to FriendTalk with template preview text
  console.warn(
    `[notification] AlimTalk "${templateCode}" failed: ${alimResult.error}, falling back to FriendTalk`,
  );

  const template = getAlimTalkTemplate(templateCode);
  if (!template) {
    return {
      success: false,
      method: "alimtalk",
      error: `AlimTalk failed: ${alimResult.error}; template "${templateCode}" not found for fallback`,
    };
  }

  // Build fallback message from template preview
  const fallbackMessage = buildFallbackMessage(template, params);

  const friendResult = await apiClient.sendFriendTalk({
    recipientNo,
    content: fallbackMessage,
  });

  if (friendResult.success) {
    console.log(
      `[notification] FriendTalk fallback for "${templateCode}" sent to ${recipientNo.slice(0, 7)}***`,
    );
    return {
      success: true,
      method: "friendtalk",
      requestId: friendResult.requestId,
    };
  }

  return {
    success: false,
    method: "friendtalk",
    error: `AlimTalk: ${alimResult.error}; FriendTalk: ${friendResult.error}`,
  };
}

/**
 * Build a FriendTalk fallback message from an AlimTalk template
 */
function buildFallbackMessage(template: AlimTalkTemplate, params: Record<string, string>): string {
  let message = template.messagePreview;

  // Replace #{param} placeholders with actual values
  for (const [key, value] of Object.entries(params)) {
    message = message.replace(new RegExp(`#\\{${key}\\}`, "g"), value);
  }

  return message;
}

/**
 * Truncate text for template variable length limits
 * NHN Cloud has a 14-char variance limit for new accounts
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
