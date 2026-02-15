/**
 * 3-Tier Free-First Message Router (무료 우선 발송 라우터)
 *
 * 메시지 발송 시 비용이 없는 채널을 먼저 시도하고,
 * 모두 실패할 경우에만 유료 알림톡/친구톡을 사용합니다.
 *
 * 1계층: Gateway 직접 전송 (무료, 즉시) — 앱 포그라운드/연결 중
 * 2계층: FCM/APNs 푸시 (무료, 백그라운드) — 앱 미연결 but 토큰 보유
 * 3계층: 알림톡/친구톡 (유료, 최후 수단) — 1,2계층 모두 실패 시
 *
 * 사업 초기 비용 절감을 위해 3계층은 기본 비활성화 가능
 */

import {
  sendGatewayPush,
  hasConnectedDevices,
  type GatewayPushMessage,
} from "./gateway-push.js";
import {
  sendFcmPush,
  isFcmConfigured,
  type FcmMessage,
} from "./fcm-service.js";
import { getUserPushTokens, removePushToken } from "./push-token-store.js";

export type DeliveryMethod =
  | "gateway"
  | "fcm"
  | "apns"
  | "alimtalk"
  | "friendtalk"
  | "failed";

export interface RouteResult {
  success: boolean;
  method: DeliveryMethod;
  /** 1~3계층 중 어디서 성공했는지 */
  tier: 1 | 2 | 3 | 0;
  error?: string;
  /** 발송 시도 이력 */
  attempts: Array<{
    tier: number;
    method: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
}

export interface MessagePayload {
  title: string;
  body: string;
  /** 앱 내 추가 데이터 */
  data?: Record<string, string>;
}

export interface RouteOptions {
  /** 사용자 ID (Supabase UUID) */
  userId: string;
  /** 메시지 내용 */
  message: MessagePayload;
  /** 3계층(유료) 사용 허용 여부. 기본: false (무료만) */
  allowPaidFallback?: boolean;
  /** 3계층에서 알림톡 사용 시 콜백 (외부에서 주입) */
  onPaidFallback?: (
    userId: string,
    message: MessagePayload,
  ) => Promise<{ success: boolean; method: "alimtalk" | "friendtalk"; error?: string }>;
}

/**
 * 3계층 무료 우선 메시지 라우팅
 *
 * 발송 순서:
 * 1. Gateway WebSocket (연결 중이면 즉시 전달)
 * 2. FCM/APNs 푸시 (토큰이 있으면 푸시 전송)
 * 3. 알림톡/친구톡 (allowPaidFallback=true 이고 콜백 제공 시)
 */
export async function routeMessage(opts: RouteOptions): Promise<RouteResult> {
  const { userId, message, allowPaidFallback = false, onPaidFallback } = opts;
  const attempts: RouteResult["attempts"] = [];

  // ─── 1계층: Gateway 직접 전송 ───
  if (hasConnectedDevices(userId)) {
    const start = Date.now();
    const gwResult = sendGatewayPush(userId, message as GatewayPushMessage);
    const durationMs = Date.now() - start;

    attempts.push({
      tier: 1,
      method: "gateway",
      success: gwResult.success,
      error: gwResult.error,
      durationMs,
    });

    if (gwResult.success) {
      console.log(`[router] Tier 1 (Gateway) delivered to ${userId.slice(0, 8)}... (${gwResult.deliveredCount} devices)`);
      return { success: true, method: "gateway", tier: 1, attempts };
    }
  }

  // ─── 2계층: FCM/APNs 푸시 ───
  if (isFcmConfigured()) {
    const pushTokens = await getUserPushTokens(userId);

    if (pushTokens.length > 0) {
      const fcmMessage: FcmMessage = {
        title: message.title,
        body: message.body,
        data: {
          ...message.data,
          type: "moa_notification",
          timestamp: String(Date.now()),
        },
      };

      for (const tokenInfo of pushTokens) {
        const start = Date.now();
        const pushResult = await sendFcmPush(tokenInfo.pushToken, fcmMessage);
        const durationMs = Date.now() - start;

        attempts.push({
          tier: 2,
          method: tokenInfo.pushPlatform,
          success: pushResult.success,
          error: pushResult.error,
          durationMs,
        });

        // 토큰 만료 시 자동 삭제
        if (pushResult.tokenExpired) {
          console.log(`[router] Removing expired push token for device ${tokenInfo.deviceId}`);
          await removePushToken(tokenInfo.deviceId);
        }

        if (pushResult.success) {
          console.log(`[router] Tier 2 (${tokenInfo.pushPlatform.toUpperCase()}) delivered to ${tokenInfo.deviceName}`);
          return {
            success: true,
            method: tokenInfo.pushPlatform === "apns" ? "apns" : "fcm",
            tier: 2,
            attempts,
          };
        }
      }
    }
  }

  // ─── 3계층: 알림톡/친구톡 (유료, 선택적) ───
  if (allowPaidFallback && onPaidFallback) {
    const start = Date.now();
    const paidResult = await onPaidFallback(userId, message);
    const durationMs = Date.now() - start;

    attempts.push({
      tier: 3,
      method: paidResult.method,
      success: paidResult.success,
      error: paidResult.error,
      durationMs,
    });

    if (paidResult.success) {
      console.log(`[router] Tier 3 (${paidResult.method}) delivered to ${userId.slice(0, 8)}... (PAID)`);
      return {
        success: true,
        method: paidResult.method,
        tier: 3,
        attempts,
      };
    }
  }

  // 모든 계층 실패
  const errorSummary = attempts.map((a) => `tier${a.tier}(${a.method}): ${a.error}`).join("; ");
  console.warn(`[router] All tiers failed for ${userId.slice(0, 8)}...: ${errorSummary}`);

  return {
    success: false,
    method: "failed",
    tier: 0,
    error: errorSummary || "No delivery channel available",
    attempts,
  };
}

/**
 * 메시지 라우팅 (간편 버전 — 무료 채널만 사용)
 */
export async function routeMessageFreeOnly(
  userId: string,
  message: MessagePayload,
): Promise<RouteResult> {
  return routeMessage({
    userId,
    message,
    allowPaidFallback: false,
  });
}
