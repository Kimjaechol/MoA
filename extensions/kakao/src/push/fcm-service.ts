/**
 * Firebase Cloud Messaging (FCM) Service
 *
 * FCM HTTP v1 API를 사용하여 Android/iOS 디바이스에 푸시 알림을 보냅니다.
 * Firebase Admin SDK 없이 직접 HTTP 요청으로 구현하여 의존성을 최소화합니다.
 *
 * 비용: 무료 (FCM은 무제한 무료)
 *
 * 환경변수:
 *   FIREBASE_PROJECT_ID     - Firebase 프로젝트 ID
 *   FIREBASE_CLIENT_EMAIL   - 서비스 계정 이메일
 *   FIREBASE_PRIVATE_KEY    - 서비스 계정 비공개 키 (PEM)
 */

import { createSign } from "node:crypto";

export interface FcmMessage {
  title: string;
  body: string;
  /** 앱에서 처리할 추가 데이터 */
  data?: Record<string, string>;
}

export interface FcmSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** 토큰이 만료되어 삭제해야 하는 경우 */
  tokenExpired?: boolean;
}

export interface FcmConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * FCM 설정이 유효한지 확인
 */
export function isFcmConfigured(): boolean {
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
}

/**
 * 환경변수에서 FCM 설정 로드
 */
function getFcmConfig(): FcmConfig | null {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return { projectId, clientEmail, privateKey };
}

/**
 * Google OAuth2 액세스 토큰 생성 (서비스 계정 JWT)
 *
 * Firebase Admin SDK 없이 직접 JWT를 생성하여 OAuth2 토큰을 교환합니다.
 */
async function getAccessToken(config: FcmConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.clientEmail,
    sub: config.clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signInput = `${headerB64}.${payloadB64}`;

  const sign = createSign("RSA-SHA256");
  sign.update(signInput);
  const signature = sign.sign(config.privateKey, "base64url");

  const jwt = `${signInput}.${signature}`;

  // JWT를 사용하여 액세스 토큰 교환
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth2 token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

// 토큰 캐시 (1시간 유효, 50분에 갱신)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getCachedAccessToken(config: FcmConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const token = await getAccessToken(config);
  cachedToken = { token, expiresAt: now + 50 * 60 * 1000 };
  return token;
}

/**
 * FCM으로 푸시 알림 전송
 */
export async function sendFcmPush(
  deviceToken: string,
  message: FcmMessage,
): Promise<FcmSendResult> {
  const config = getFcmConfig();
  if (!config) {
    return { success: false, error: "FCM not configured" };
  }

  try {
    const accessToken = await getCachedAccessToken(config);
    const url = `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`;

    const fcmPayload = {
      message: {
        token: deviceToken,
        notification: {
          title: message.title,
          body: message.body,
        },
        data: message.data ?? {},
        // Android 설정: 높은 우선순위로 즉시 전달
        android: {
          priority: "high" as const,
          notification: {
            channel_id: "moa_messages",
            priority: "high" as const,
          },
        },
        // iOS(APNs) 설정
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              alert: {
                title: message.title,
                body: message.body,
              },
              sound: "default",
              badge: 1,
            },
          },
        },
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fcmPayload),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = (await response.json()) as { name: string };
      return { success: true, messageId: data.name };
    }

    const errorData = (await response.json()) as {
      error?: { code?: number; message?: string; status?: string; details?: Array<{ errorCode?: string }> };
    };

    // 토큰 만료/무효 체크 — 앱 삭제 등으로 토큰이 무효화된 경우
    const errorCode = errorData.error?.details?.[0]?.errorCode;
    if (
      errorCode === "UNREGISTERED" ||
      errorCode === "INVALID_ARGUMENT" ||
      response.status === 404
    ) {
      return {
        success: false,
        error: `Token expired: ${errorCode}`,
        tokenExpired: true,
      };
    }

    return {
      success: false,
      error: errorData.error?.message ?? `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 여러 디바이스에 동시 전송
 */
export async function sendFcmPushMultiple(
  deviceTokens: string[],
  message: FcmMessage,
): Promise<FcmSendResult[]> {
  return Promise.all(deviceTokens.map((token) => sendFcmPush(token, message)));
}

function base64url(str: string): string {
  return Buffer.from(str, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
