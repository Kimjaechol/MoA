/**
 * 결제 웹훅 핸들러
 *
 * 토스페이먼츠와 카카오페이의 결제 콜백 처리
 * - 결제 승인 콜백
 * - 정기 결제 콜백
 * - 웹훅 알림
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { parse as parseUrl } from "node:url";
import { confirmPayment, verifyWebhookSignature } from "./toss-payments.js";
import { approvePayment } from "./kakao-pay.js";
import {
  updateSubscriptionStatus,
  getUserSubscription,
  recordPayment,
  type PaymentRecord,
} from "../installer/subscription.js";

// ============================================
// Types
// ============================================

export interface PaymentCallbackParams {
  /** 결제 수단 */
  provider: "toss" | "kakao";
  /** 결제 성공 여부 */
  success: boolean;
  /** 에러 코드 */
  errorCode?: string;
  /** 에러 메시지 */
  errorMessage?: string;

  // Toss specific
  paymentKey?: string;
  orderId?: string;
  amount?: string;

  // Kakao specific
  pgToken?: string;
  tid?: string;
}

export interface WebhookPayload {
  eventType: string;
  data: unknown;
}

// ============================================
// Callback URL Handlers
// ============================================

/**
 * 토스페이먼츠 결제 성공 콜백 처리
 */
async function handleTossSuccess(
  params: URLSearchParams,
  logger?: Pick<Console, "log" | "error">
): Promise<{ success: boolean; message: string; redirectUrl?: string }> {
  const paymentKey = params.get("paymentKey");
  const orderId = params.get("orderId");
  const amount = params.get("amount");

  if (!paymentKey || !orderId || !amount) {
    return {
      success: false,
      message: "필수 파라미터가 누락되었습니다.",
    };
  }

  logger?.log(`[Payment] Toss success callback: orderId=${orderId}`);

  // 결제 승인
  const result = await confirmPayment({
    paymentKey,
    orderId,
    amount: parseInt(amount, 10),
  });

  if (!result.success) {
    return {
      success: false,
      message: result.error?.message ?? "결제 승인 실패",
    };
  }

  // 주문 정보 파싱 (orderId: moa_sub_{userId}_{planType}_{timestamp})
  const orderParts = orderId.split("_");
  if (orderParts[0] === "moa" && orderParts[1] === "sub" && orderParts.length >= 4) {
    const userId = orderParts[2];
    const planType = orderParts[3] as "basic" | "pro" | "enterprise";

    // 구독 상태 업데이트
    await updateSubscriptionStatus(userId, planType, {
      paymentKey,
      provider: "toss",
    });

    // 결제 기록
    await recordPayment({
      userId,
      orderId,
      paymentKey,
      provider: "toss",
      amount: parseInt(amount, 10),
      status: "completed",
      planType,
    });
  }

  return {
    success: true,
    message: "결제가 완료되었습니다.",
    redirectUrl: `/payment/complete?orderId=${orderId}`,
  };
}

/**
 * 토스페이먼츠 결제 실패 콜백 처리
 */
function handleTossFail(
  params: URLSearchParams,
  logger?: Pick<Console, "log" | "error">
): { success: boolean; message: string; redirectUrl?: string } {
  const code = params.get("code");
  const message = params.get("message");
  const orderId = params.get("orderId");

  logger?.log(`[Payment] Toss fail callback: orderId=${orderId}, code=${code}`);

  return {
    success: false,
    message: message ?? "결제가 실패했습니다.",
    redirectUrl: `/payment/fail?orderId=${orderId}&code=${code}`,
  };
}

/**
 * 카카오페이 결제 성공 콜백 처리
 */
async function handleKakaoSuccess(
  params: URLSearchParams,
  sessionStore: Map<string, { tid: string; orderId: string; userId: string; amount: number; planType?: string }>,
  logger?: Pick<Console, "log" | "error">
): Promise<{ success: boolean; message: string; redirectUrl?: string }> {
  const pgToken = params.get("pg_token");
  const orderId = params.get("orderId");

  if (!pgToken || !orderId) {
    return {
      success: false,
      message: "필수 파라미터가 누락되었습니다.",
    };
  }

  // 세션에서 tid와 사용자 정보 조회
  const session = sessionStore.get(orderId);
  if (!session) {
    return {
      success: false,
      message: "결제 세션이 만료되었습니다.",
    };
  }

  logger?.log(`[Payment] Kakao success callback: orderId=${orderId}`);

  // 결제 승인
  const result = await approvePayment({
    tid: session.tid,
    partnerOrderId: orderId,
    partnerUserId: session.userId,
    pgToken,
  });

  if (!result.success) {
    return {
      success: false,
      message: result.error?.message ?? "결제 승인 실패",
    };
  }

  // 구독 결제인 경우 처리
  if (session.planType) {
    await updateSubscriptionStatus(session.userId, session.planType as "basic" | "pro" | "enterprise", {
      paymentKey: result.tid,
      provider: "kakao",
    });

    await recordPayment({
      userId: session.userId,
      orderId,
      paymentKey: result.tid ?? session.tid,
      provider: "kakao",
      amount: session.amount,
      status: "completed",
      planType: session.planType as "basic" | "pro" | "enterprise",
    });
  }

  // 세션 정리
  sessionStore.delete(orderId);

  return {
    success: true,
    message: "결제가 완료되었습니다.",
    redirectUrl: `/payment/complete?orderId=${orderId}`,
  };
}

/**
 * 카카오페이 결제 취소/실패 콜백 처리
 */
function handleKakaoCancel(
  params: URLSearchParams,
  sessionStore: Map<string, unknown>,
  logger?: Pick<Console, "log" | "error">
): { success: boolean; message: string; redirectUrl?: string } {
  const orderId = params.get("orderId");

  logger?.log(`[Payment] Kakao cancel callback: orderId=${orderId}`);

  // 세션 정리
  if (orderId) {
    sessionStore.delete(orderId);
  }

  return {
    success: false,
    message: "결제가 취소되었습니다.",
    redirectUrl: `/payment/cancel?orderId=${orderId}`,
  };
}

// ============================================
// Webhook Handler
// ============================================

/**
 * 토스페이먼츠 웹훅 처리
 */
async function handleTossWebhook(
  payload: string,
  signature: string,
  logger?: Pick<Console, "log" | "error">
): Promise<{ success: boolean; message: string }> {
  // 서명 검증
  if (!verifyWebhookSignature(payload, signature)) {
    logger?.error("[Payment] Toss webhook signature verification failed");
    return {
      success: false,
      message: "Invalid signature",
    };
  }

  const data = JSON.parse(payload) as {
    eventType: string;
    data: {
      paymentKey?: string;
      orderId?: string;
      status?: string;
    };
  };

  logger?.log(`[Payment] Toss webhook: ${data.eventType}`);

  switch (data.eventType) {
    case "PAYMENT_STATUS_CHANGED":
      // 결제 상태 변경 처리
      break;
    case "BILLING_PAYMENT_SUCCEEDED":
      // 정기 결제 성공
      break;
    case "BILLING_PAYMENT_FAILED":
      // 정기 결제 실패
      break;
  }

  return {
    success: true,
    message: "OK",
  };
}

// ============================================
// Main Request Handler
// ============================================

// 결제 세션 저장소 (실제 서비스에서는 Redis 등 사용)
const paymentSessions = new Map<
  string,
  { tid: string; orderId: string; userId: string; amount: number; planType?: string }
>();

/**
 * 결제 관련 요청 처리
 */
export function handlePaymentRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger?: Pick<Console, "log" | "error">
): boolean {
  const url = parseUrl(req.url ?? "", true);
  const pathname = url.pathname ?? "";

  // 결제 콜백 경로만 처리
  if (!pathname.startsWith("/payment/")) {
    return false;
  }

  const sendJson = (statusCode: number, data: unknown) => {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  const sendHtml = (statusCode: number, html: string) => {
    res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  };

  // 라우팅
  (async () => {
    try {
      const params = new URLSearchParams(url.search ?? "");

      // 토스페이먼츠 콜백
      if (pathname === "/payment/toss/success") {
        const result = await handleTossSuccess(params, logger);
        if (result.redirectUrl) {
          res.writeHead(302, { Location: result.redirectUrl });
          res.end();
        } else {
          sendHtml(200, generateResultPage(result.success, result.message));
        }
        return;
      }

      if (pathname === "/payment/toss/fail") {
        const result = handleTossFail(params, logger);
        sendHtml(200, generateResultPage(false, result.message));
        return;
      }

      // 카카오페이 콜백
      if (pathname === "/payment/kakao/success") {
        const result = await handleKakaoSuccess(params, paymentSessions, logger);
        if (result.redirectUrl) {
          res.writeHead(302, { Location: result.redirectUrl });
          res.end();
        } else {
          sendHtml(200, generateResultPage(result.success, result.message));
        }
        return;
      }

      if (pathname === "/payment/kakao/cancel" || pathname === "/payment/kakao/fail") {
        const result = handleKakaoCancel(params, paymentSessions, logger);
        sendHtml(200, generateResultPage(false, result.message));
        return;
      }

      // 웹훅 엔드포인트
      if (pathname === "/payment/webhook/toss" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          const signature = req.headers["toss-signature"] as string ?? "";
          const result = await handleTossWebhook(body, signature, logger);
          sendJson(result.success ? 200 : 400, result);
        });
        return;
      }

      // 결제 완료 페이지
      if (pathname === "/payment/complete") {
        const orderId = params.get("orderId");
        sendHtml(200, generateCompletePage(orderId ?? ""));
        return;
      }

      // 결제 실패 페이지
      if (pathname === "/payment/fail" || pathname === "/payment/cancel") {
        const orderId = params.get("orderId");
        const code = params.get("code");
        sendHtml(200, generateFailPage(orderId ?? "", code ?? ""));
        return;
      }

      // 404
      sendJson(404, { error: "Not Found" });
    } catch (error) {
      logger?.error("[Payment] Error handling request:", error);
      sendJson(500, { error: "Internal Server Error" });
    }
  })();

  return true;
}

/**
 * 결제 세션 저장 (외부에서 사용)
 */
export function savePaymentSession(
  orderId: string,
  session: { tid: string; userId: string; amount: number; planType?: string }
): void {
  paymentSessions.set(orderId, { ...session, orderId });
}

/**
 * 결제 세션 조회
 */
export function getPaymentSession(
  orderId: string
): { tid: string; orderId: string; userId: string; amount: number; planType?: string } | undefined {
  return paymentSessions.get(orderId);
}

// ============================================
// HTML Templates
// ============================================

function generateResultPage(success: boolean, message: string): string {
  const icon = success ? "&#10004;" : "&#10006;";
  const color = success ? "#4CAF50" : "#f44336";
  const title = success ? "결제 완료" : "결제 실패";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - MoA</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px;
    }
    .icon {
      font-size: 64px;
      color: ${color};
      margin-bottom: 24px;
    }
    h1 {
      color: #333;
      margin-bottom: 16px;
    }
    p {
      color: #666;
      line-height: 1.6;
    }
    .btn {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 32px;
      background: ${color};
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/" class="btn">홈으로</a>
  </div>
</body>
</html>`;
}

function generateCompletePage(orderId: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>결제 완료 - MoA</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
    }
    .icon { font-size: 80px; margin-bottom: 24px; }
    h1 { color: #333; margin-bottom: 16px; }
    p { color: #666; line-height: 1.6; margin-bottom: 8px; }
    .order-id { font-family: monospace; background: #f5f5f5; padding: 8px 16px; border-radius: 4px; }
    .features {
      text-align: left;
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin: 24px 0;
    }
    .features li {
      margin: 8px 0;
      color: #444;
    }
    .btn {
      display: inline-block;
      margin-top: 16px;
      padding: 14px 36px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#127881;</div>
    <h1>결제가 완료되었습니다!</h1>
    <p>주문번호: <span class="order-id">${orderId}</span></p>

    <div class="features">
      <strong>이제 다음 기능을 사용하실 수 있습니다:</strong>
      <ul>
        <li>무제한 기기 연결</li>
        <li>하루 무제한 명령</li>
        <li>실시간 메모리 동기화</li>
        <li>우선 지원</li>
      </ul>
    </div>

    <p>카카오톡에서 <strong>/구독상태</strong>를 입력하여 확인하세요.</p>
    <a href="/" class="btn">홈으로 돌아가기</a>
  </div>
</body>
</html>`;
}

function generateFailPage(orderId: string, errorCode: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>결제 실패 - MoA</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px;
    }
    .icon { font-size: 64px; margin-bottom: 24px; }
    h1 { color: #333; margin-bottom: 16px; }
    p { color: #666; line-height: 1.6; }
    .error-code {
      font-family: monospace;
      background: #fff3f3;
      color: #d32f2f;
      padding: 8px 16px;
      border-radius: 4px;
      margin: 16px 0;
    }
    .btn {
      display: inline-block;
      margin-top: 24px;
      padding: 12px 32px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin-right: 8px;
    }
    .btn-outline {
      background: transparent;
      border: 2px solid #667eea;
      color: #667eea;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">&#128543;</div>
    <h1>결제에 실패했습니다</h1>
    ${errorCode ? `<p class="error-code">오류 코드: ${errorCode}</p>` : ""}
    <p>결제 중 문제가 발생했습니다.<br>잠시 후 다시 시도해주세요.</p>
    ${orderId ? `<p>주문번호: ${orderId}</p>` : ""}
    <div>
      <a href="/install" class="btn">다시 시도</a>
      <a href="/" class="btn btn-outline">홈으로</a>
    </div>
  </div>
</body>
</html>`;
}
