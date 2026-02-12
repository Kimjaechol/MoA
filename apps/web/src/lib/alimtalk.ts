/**
 * 알림톡 발송 서비스
 *
 * NHN Cloud Toast API를 사용하여 알림톡을 발송합니다.
 * 기존 kakaomolt의 KakaoApiClient.sendAlimTalk()과 동일한 API를 사용하지만,
 * Next.js API 라우트에서 직접 호출할 수 있도록 독립적으로 구현합니다.
 *
 * 필요 환경변수:
 *   TOAST_APP_KEY     — NHN Cloud Toast App Key
 *   TOAST_SECRET_KEY  — NHN Cloud Toast Secret Key
 *   KAKAO_SENDER_KEY  — 카카오 발신 프로필 키
 */

import { getServiceSupabase } from "./supabase";

const TOAST_BASE_URL = "https://api-alimtalk.cloud.toast.com";

type AlimtalkSendResult = {
  success: boolean;
  requestId?: string;
  error?: string;
};

/** 발송에 필요한 크리덴셜 */
function getCredentials(): {
  toastAppKey: string;
  toastSecretKey: string;
  senderKey: string;
} | null {
  const toastAppKey = process.env.TOAST_APP_KEY;
  const toastSecretKey = process.env.TOAST_SECRET_KEY;
  const senderKey = process.env.KAKAO_SENDER_KEY;

  if (!toastAppKey || !toastSecretKey || !senderKey) {
    return null;
  }

  return { toastAppKey, toastSecretKey, senderKey };
}

/**
 * 알림톡 발송
 */
export async function sendAlimtalk(params: {
  recipientNo: string;
  templateCode: string;
  templateParameter?: Record<string, string>;
}): Promise<AlimtalkSendResult> {
  const creds = getCredentials();
  if (!creds) {
    return {
      success: false,
      error: "알림톡 크리덴셜 미설정 (TOAST_APP_KEY, TOAST_SECRET_KEY, KAKAO_SENDER_KEY)",
    };
  }

  const url = `${TOAST_BASE_URL}/alimtalk/v2.2/appkeys/${creds.toastAppKey}/messages`;

  const body = {
    senderKey: creds.senderKey,
    templateCode: params.templateCode,
    recipientList: [
      {
        recipientNo: params.recipientNo,
        templateParameter: params.templateParameter ?? {},
      },
    ],
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        "X-Secret-Key": creds.toastSecretKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await response.json()) as {
      code: number;
      message: string;
      data?: unknown;
    };

    if (response.ok && data.code === 0) {
      return { success: true, requestId: String(data.data) };
    }

    return { success: false, error: data.message || `HTTP ${response.status}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 알림톡 발송 + DB 로그 기록
 */
export async function sendAlimtalkWithLog(params: {
  userId: string;
  recipientNo: string;
  templateCode: string;
  templateParameter?: Record<string, string>;
}): Promise<AlimtalkSendResult> {
  const result = await sendAlimtalk({
    recipientNo: params.recipientNo,
    templateCode: params.templateCode,
    templateParameter: params.templateParameter,
  });

  // DB에 발송 로그 기록
  try {
    const supabase = getServiceSupabase();
    await supabase.from("moa_alimtalk_log").insert({
      user_id: params.userId,
      phone: params.recipientNo,
      template_code: params.templateCode,
      template_params: params.templateParameter ?? {},
      status: result.success ? "sent" : "failed",
      request_id: result.requestId ?? null,
      error_message: result.error ?? null,
    });
  } catch {
    // 로그 기록 실패는 발송 결과에 영향 주지 않음
  }

  return result;
}

/**
 * 특정 사용자에게 이미 특정 템플릿의 알림톡을 보냈는지 확인
 */
export async function hasAlreadySent(params: {
  userId: string;
  templateCode: string;
}): Promise<boolean> {
  try {
    const supabase = getServiceSupabase();
    const { data } = await supabase
      .from("moa_alimtalk_log")
      .select("id")
      .eq("user_id", params.userId)
      .eq("template_code", params.templateCode)
      .eq("status", "sent")
      .limit(1);

    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * 전화번호 정규화 (한국 번호)
 * - 하이픈 제거
 * - 010-1234-5678 → 01012345678
 * - +82-10-1234-5678 → 01012345678
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, "");

  // +82 국제번호 처리
  if (cleaned.startsWith("+82")) {
    cleaned = "0" + cleaned.slice(3);
  } else if (cleaned.startsWith("82")) {
    cleaned = "0" + cleaned.slice(2);
  }

  return cleaned;
}

/**
 * 한국 휴대폰 번호 유효성 검사
 */
export function isValidKoreanMobile(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return /^01[016789]\d{7,8}$/.test(normalized);
}
