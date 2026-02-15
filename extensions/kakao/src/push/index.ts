/**
 * MoA Push Module
 *
 * 3계층 무료 우선 발송 체계:
 *   1계층: Gateway 직접 전송 (무료)
 *   2계층: FCM/APNs 푸시 (무료)
 *   3계층: 알림톡/친구톡 (유료 — 기본 비활성)
 */

// Message Router (핵심)
export {
  routeMessage,
  routeMessageFreeOnly,
  type RouteResult,
  type RouteOptions,
  type MessagePayload,
  type DeliveryMethod,
} from "./message-router.js";

// Gateway Push (1계층)
export {
  registerGatewayManager,
  sendGatewayPush,
  hasConnectedDevices,
  isGatewayPushAvailable,
  type GatewayConnectionManager,
  type GatewayPushMessage,
} from "./gateway-push.js";

// FCM Service (2계층)
export {
  sendFcmPush,
  sendFcmPushMultiple,
  isFcmConfigured,
  type FcmMessage,
  type FcmSendResult,
} from "./fcm-service.js";

// Push Token Store
export {
  savePushToken,
  getUserPushTokens,
  getDevicePushToken,
  removePushToken,
  type PushTokenInfo,
  type PushPlatform,
} from "./push-token-store.js";
