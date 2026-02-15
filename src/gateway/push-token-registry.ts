/**
 * Push Token Registry (게이트웨이 인메모리 푸시 토큰 저장소)
 *
 * 연결된 노드 디바이스의 FCM/APNs 푸시 토큰을 메모리에 저장합니다.
 * 게이트웨이가 GatewayConnectionManager 역할을 할 때
 * 노드의 푸시 토큰을 외부 서비스(MoA 서버)에 전달하기 위해 사용됩니다.
 */

export type PushPlatform = "fcm" | "apns";

export interface PushTokenEntry {
  nodeId: string;
  pushToken: string;
  pushPlatform: PushPlatform;
  registeredAt: number;
}

const tokensByNode = new Map<string, PushTokenEntry>();

/**
 * 노드의 푸시 토큰 저장
 */
export function setPushToken(nodeId: string, pushToken: string, pushPlatform: PushPlatform): void {
  tokensByNode.set(nodeId, {
    nodeId,
    pushToken,
    pushPlatform,
    registeredAt: Date.now(),
  });
}

/**
 * 노드의 푸시 토큰 조회
 */
export function getPushToken(nodeId: string): PushTokenEntry | undefined {
  return tokensByNode.get(nodeId);
}

/**
 * 노드의 푸시 토큰 삭제 (연결 해제 시)
 */
export function removePushToken(nodeId: string): void {
  tokensByNode.delete(nodeId);
}

/**
 * 모든 등록된 푸시 토큰 목록
 */
export function listPushTokens(): PushTokenEntry[] {
  return [...tokensByNode.values()];
}

/**
 * 전체 초기화 (테스트용)
 */
export function clearAllPushTokens(): void {
  tokensByNode.clear();
}
