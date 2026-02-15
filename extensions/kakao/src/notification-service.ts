/**
 * MoA Notification Service
 *
 * 3계층 무료 우선 발송 체계를 지원하는 알림 서비스.
 *
 * 발송 우선순위:
 *   1. Gateway WebSocket 직접 전송 (무료)
 *   2. FCM/APNs 푸시 알림 (무료)
 *   3. AlimTalk/FriendTalk (유료 — 기본 비활성)
 *
 * userId 기반 발송:
 *   notifyByUserId() — 3계층 라우터를 통해 무료 우선 발송
 *
 * 기존 호환 (phoneNumber 기반):
 *   notifyDevicePaired(), sendAlimTalk() 등 — 기존 유료 경로 유지
 *
 * Usage:
 *   const notifier = createNotificationService(account);
 *   // 무료 우선: userId로 발송
 *   await notifier.notifyByUserId(userId, { title: "연결 완료", body: "노트북이 연결되었습니다" });
 *   // 기존 호환: 전화번호로 알림톡 발송
 *   await notifier.notifyDevicePaired(phoneNumber, "노트북");
 */

import type { ResolvedKakaoAccount } from "./types.js";
import { createKakaoApiClient } from "./api-client.js";
import {
  getAlimTalkTemplate,
  validateTemplateParams,
  type AlimTalkTemplate,
} from "./alimtalk-templates.js";
import {
  routeMessage,
  routeMessageFreeOnly,
  type MessagePayload,
  type RouteResult,
} from "./push/index.js";

export interface NotificationResult {
  success: boolean;
  method: "alimtalk" | "friendtalk" | "none" | "gateway" | "fcm" | "apns";
  error?: string;
  requestId?: string;
  /** 무료 채널로 전달되었는지 */
  free?: boolean;
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

  /**
   * 3계층 무료 우선 발송 (userId 기반)
   *
   * 1계층: Gateway WebSocket (무료)
   * 2계층: FCM/APNs (무료)
   * 3계층: 알림톡/친구톡 (유료 — allowPaidFallback=true 시에만)
   */
  notifyByUserId(
    userId: string,
    message: MessagePayload,
    options?: { allowPaidFallback?: boolean },
  ): Promise<NotificationResult>;

  /**
   * 무료 채널만 사용하여 발송 (Gateway + FCM 만 시도)
   */
  notifyFreeOnly(userId: string, message: MessagePayload): Promise<NotificationResult>;
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

    async notifyByUserId(userId, message, options) {
      const allowPaid = options?.allowPaidFallback ?? false;

      // 3계층 유료 폴백 콜백: userId → 전화번호 조회 → 알림톡/친구톡
      const onPaidFallback = allowPaid && configured
        ? async (uid: string, msg: MessagePayload) => {
            // userId로 전화번호 조회 (별도 import 없이 supabase 직접 조회)
            const { getUserPhoneNumberById } = await import("./proactive-messaging.js");
            const phone = await getUserPhoneNumberById(uid);
            if (!phone) {
              return { success: false, method: "friendtalk" as const, error: "No phone number" };
            }

            const friendResult = await apiClient.sendFriendTalk({
              recipientNo: phone,
              content: `${msg.title}\n\n${msg.body}`,
            });
            return {
              success: friendResult.success,
              method: "friendtalk" as const,
              error: friendResult.error,
            };
          }
        : undefined;

      const result = await routeMessage({
        userId,
        message,
        allowPaidFallback: allowPaid,
        onPaidFallback,
      });

      return routeResultToNotificationResult(result);
    },

    async notifyFreeOnly(userId, message) {
      const result = await routeMessageFreeOnly(userId, message);
      return routeResultToNotificationResult(result);
    },
  };
}

/**
 * RouteResult → NotificationResult 변환
 */
function routeResultToNotificationResult(result: RouteResult): NotificationResult {
  const methodMap: Record<string, NotificationResult["method"]> = {
    gateway: "gateway",
    fcm: "fcm",
    apns: "apns",
    alimtalk: "alimtalk",
    friendtalk: "friendtalk",
    failed: "none",
  };

  return {
    success: result.success,
    method: methodMap[result.method] ?? "none",
    error: result.error,
    free: result.tier === 1 || result.tier === 2,
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
