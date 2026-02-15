/**
 * Gateway Direct Push (게이트웨이 직접 푸시)
 *
 * 3계층 무료 우선 발송 체계의 1계층입니다.
 * 앱이 게이트웨이에 WebSocket으로 연결되어 있을 때
 * 기존 커넥션을 통해 즉시 메시지를 전달합니다.
 *
 * 비용: 무료 (자체 서버 WebSocket)
 *
 * 게이트웨이 프로토콜 v3의 event 프레임을 사용:
 * {
 *   "type": "event",
 *   "event": "moa.notification",
 *   "payload": { title, body, data }
 * }
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";

export interface GatewayPushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface GatewayPushResult {
  success: boolean;
  /** 전달된 디바이스 수 */
  deliveredCount: number;
  error?: string;
}

/**
 * 게이트웨이 연결 매니저 인터페이스
 *
 * 서버의 게이트웨이가 이 인터페이스를 구현하여
 * 연결된 노드 디바이스에 이벤트를 보냅니다.
 */
export interface GatewayConnectionManager {
  /**
   * 특정 사용자의 연결된 디바이스 ID 목록
   */
  getConnectedDeviceIds(userId: string): string[];

  /**
   * 특정 디바이스에 이벤트 전송
   * @returns true if delivered
   */
  sendEvent(deviceId: string, event: string, payload: unknown): boolean;
}

// 싱글톤 게이트웨이 매니저 참조
let gatewayManager: GatewayConnectionManager | null = null;

/**
 * 게이트웨이 커넥션 매니저 등록
 * 서버 시작 시 호출하여 게이트웨이 인스턴스를 연결합니다.
 */
export function registerGatewayManager(manager: GatewayConnectionManager): void {
  gatewayManager = manager;
  console.log("[push:gateway] Gateway connection manager registered");
}

/**
 * 게이트웨이가 등록되어 있는지 확인
 */
export function isGatewayPushAvailable(): boolean {
  return gatewayManager !== null;
}

/**
 * 게이트웨이를 통해 사용자의 연결된 디바이스에 메시지 전송
 *
 * 연결된 모든 디바이스에 전송하며, 하나라도 성공하면 success=true
 */
export function sendGatewayPush(
  userId: string,
  message: GatewayPushMessage,
): GatewayPushResult {
  if (!gatewayManager) {
    return { success: false, deliveredCount: 0, error: "Gateway not registered" };
  }

  const connectedDevices = gatewayManager.getConnectedDeviceIds(userId);
  if (connectedDevices.length === 0) {
    return { success: false, deliveredCount: 0, error: "No connected devices" };
  }

  let deliveredCount = 0;
  for (const deviceId of connectedDevices) {
    const sent = gatewayManager.sendEvent(deviceId, "moa.notification", {
      title: message.title,
      body: message.body,
      data: message.data ?? {},
      timestamp: Date.now(),
    });
    if (sent) {
      deliveredCount++;
    }
  }

  return {
    success: deliveredCount > 0,
    deliveredCount,
    error: deliveredCount === 0 ? "All sends failed" : undefined,
  };
}

/**
 * 사용자의 디바이스가 게이트웨이에 연결되어 있는지 확인
 */
export function hasConnectedDevices(userId: string): boolean {
  if (!gatewayManager) return false;
  return gatewayManager.getConnectedDeviceIds(userId).length > 0;
}

/**
 * 사용자가 온라인인지 DB에서 확인 (게이트웨이가 없을 때 fallback)
 */
export async function isUserOnlineViaDb(userId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  const supabase = getSupabase();
  const { count } = await supabase
    .from("relay_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_online", true);

  return (count ?? 0) > 0;
}
