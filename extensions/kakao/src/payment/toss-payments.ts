/**
 * 토스페이먼츠 결제 연동
 *
 * 토스페이먼츠 API를 통한 결제 처리
 * - 카드 결제
 * - 간편 결제 (토스페이, 카카오페이 등)
 * - 정기 결제 (구독)
 *
 * 환경변수:
 * - TOSS_CLIENT_KEY: 클라이언트 키
 * - TOSS_SECRET_KEY: 시크릿 키 (서버용)
 * - TOSS_WEBHOOK_SECRET: 웹훅 시크릿
 */

import { createHmac } from "node:crypto";

// ============================================
// Configuration
// ============================================

export interface TossPaymentsConfig {
  clientKey: string;
  secretKey: string;
  webhookSecret?: string;
  /** 테스트 모드 여부 */
  testMode: boolean;
}

export function getTossConfig(): TossPaymentsConfig {
  const clientKey = process.env.TOSS_CLIENT_KEY ?? "";
  const secretKey = process.env.TOSS_SECRET_KEY ?? "";

  // 테스트 키는 "test_"로 시작
  const testMode = clientKey.startsWith("test_") || secretKey.startsWith("test_");

  return {
    clientKey,
    secretKey,
    webhookSecret: process.env.TOSS_WEBHOOK_SECRET,
    testMode,
  };
}

const TOSS_API_BASE = "https://api.tosspayments.com/v1";

// ============================================
// Types
// ============================================

export interface PaymentRequest {
  /** 주문 ID (고유) */
  orderId: string;
  /** 결제 금액 */
  amount: number;
  /** 주문명 */
  orderName: string;
  /** 구매자 이름 */
  customerName?: string;
  /** 구매자 이메일 */
  customerEmail?: string;
  /** 성공 리다이렉트 URL */
  successUrl: string;
  /** 실패 리다이렉트 URL */
  failUrl: string;
  /** 결제 방법 */
  method?: "카드" | "가상계좌" | "간편결제" | "휴대폰" | "계좌이체";
}

export interface PaymentConfirmation {
  paymentKey: string;
  orderId: string;
  amount: number;
}

export interface PaymentResult {
  success: boolean;
  paymentKey?: string;
  orderId?: string;
  status?: PaymentStatus;
  method?: string;
  totalAmount?: number;
  approvedAt?: string;
  receipt?: {
    url: string;
  };
  card?: {
    company: string;
    number: string;
    installmentPlanMonths: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

export type PaymentStatus =
  | "READY"
  | "IN_PROGRESS"
  | "WAITING_FOR_DEPOSIT"
  | "DONE"
  | "CANCELED"
  | "PARTIAL_CANCELED"
  | "ABORTED"
  | "EXPIRED";

export interface BillingKeyRequest {
  /** 고객 키 (고유 식별자) */
  customerKey: string;
  /** 카드 번호 */
  cardNumber: string;
  /** 유효기간 (YYMM) */
  cardExpirationYear: string;
  cardExpirationMonth: string;
  /** 생년월일 6자리 또는 사업자번호 10자리 */
  customerIdentityNumber: string;
}

export interface BillingKeyResult {
  success: boolean;
  billingKey?: string;
  customerKey?: string;
  cardCompany?: string;
  cardNumber?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface BillingPaymentRequest {
  /** 빌링키 */
  billingKey: string;
  /** 고객 키 */
  customerKey: string;
  /** 결제 금액 */
  amount: number;
  /** 주문 ID */
  orderId: string;
  /** 주문명 */
  orderName: string;
}

// ============================================
// API Helpers
// ============================================

async function tossApiRequest<T>(
  endpoint: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const config = getTossConfig();

  if (!config.secretKey) {
    throw new Error("TOSS_SECRET_KEY가 설정되지 않았습니다.");
  }

  // Basic Auth: secretKey를 base64로 인코딩
  const authHeader = Buffer.from(`${config.secretKey}:`).toString("base64");

  const response = await fetch(`${TOSS_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json();

  if (!response.ok) {
    throw {
      code: data.code ?? "UNKNOWN_ERROR",
      message: data.message ?? "결제 요청 실패",
    };
  }

  return data as T;
}

// ============================================
// Payment Operations
// ============================================

/**
 * 결제 승인 (결제창에서 돌아온 후 호출)
 */
export async function confirmPayment(confirmation: PaymentConfirmation): Promise<PaymentResult> {
  try {
    const result = await tossApiRequest<{
      paymentKey: string;
      orderId: string;
      status: PaymentStatus;
      method: string;
      totalAmount: number;
      approvedAt: string;
      receipt?: { url: string };
      card?: {
        company: string;
        number: string;
        installmentPlanMonths: number;
      };
    }>("/payments/confirm", "POST", {
      paymentKey: confirmation.paymentKey,
      orderId: confirmation.orderId,
      amount: confirmation.amount,
    });

    return {
      success: true,
      paymentKey: result.paymentKey,
      orderId: result.orderId,
      status: result.status,
      method: result.method,
      totalAmount: result.totalAmount,
      approvedAt: result.approvedAt,
      receipt: result.receipt,
      card: result.card,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CONFIRM_FAILED",
        message: err.message ?? "결제 승인 실패",
      },
    };
  }
}

/**
 * 결제 조회
 */
export async function getPayment(paymentKey: string): Promise<PaymentResult> {
  try {
    const result = await tossApiRequest<{
      paymentKey: string;
      orderId: string;
      status: PaymentStatus;
      method: string;
      totalAmount: number;
      approvedAt: string;
      receipt?: { url: string };
    }>(`/payments/${paymentKey}`, "GET");

    return {
      success: true,
      paymentKey: result.paymentKey,
      orderId: result.orderId,
      status: result.status,
      method: result.method,
      totalAmount: result.totalAmount,
      approvedAt: result.approvedAt,
      receipt: result.receipt,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "QUERY_FAILED",
        message: err.message ?? "결제 조회 실패",
      },
    };
  }
}

/**
 * 결제 취소
 */
export async function cancelPayment(
  paymentKey: string,
  cancelReason: string,
  cancelAmount?: number,
): Promise<PaymentResult> {
  try {
    const body: { cancelReason: string; cancelAmount?: number } = { cancelReason };
    if (cancelAmount !== undefined) {
      body.cancelAmount = cancelAmount;
    }

    const result = await tossApiRequest<{
      paymentKey: string;
      orderId: string;
      status: PaymentStatus;
    }>(`/payments/${paymentKey}/cancel`, "POST", body);

    return {
      success: true,
      paymentKey: result.paymentKey,
      orderId: result.orderId,
      status: result.status,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CANCEL_FAILED",
        message: err.message ?? "결제 취소 실패",
      },
    };
  }
}

// ============================================
// Billing (정기 결제)
// ============================================

/**
 * 빌링키 발급 (카드 정보로)
 */
export async function issueBillingKey(request: BillingKeyRequest): Promise<BillingKeyResult> {
  try {
    const result = await tossApiRequest<{
      billingKey: string;
      customerKey: string;
      card: {
        company: string;
        number: string;
      };
    }>("/billing/authorizations/card", "POST", {
      customerKey: request.customerKey,
      cardNumber: request.cardNumber,
      cardExpirationYear: request.cardExpirationYear,
      cardExpirationMonth: request.cardExpirationMonth,
      customerIdentityNumber: request.customerIdentityNumber,
    });

    return {
      success: true,
      billingKey: result.billingKey,
      customerKey: result.customerKey,
      cardCompany: result.card.company,
      cardNumber: result.card.number,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "BILLING_KEY_FAILED",
        message: err.message ?? "빌링키 발급 실패",
      },
    };
  }
}

/**
 * 빌링키로 결제 (자동 결제)
 */
export async function chargeBilling(request: BillingPaymentRequest): Promise<PaymentResult> {
  try {
    const result = await tossApiRequest<{
      paymentKey: string;
      orderId: string;
      status: PaymentStatus;
      method: string;
      totalAmount: number;
      approvedAt: string;
    }>(`/billing/${request.billingKey}`, "POST", {
      customerKey: request.customerKey,
      amount: request.amount,
      orderId: request.orderId,
      orderName: request.orderName,
    });

    return {
      success: true,
      paymentKey: result.paymentKey,
      orderId: result.orderId,
      status: result.status,
      method: result.method,
      totalAmount: result.totalAmount,
      approvedAt: result.approvedAt,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "BILLING_CHARGE_FAILED",
        message: err.message ?? "자동 결제 실패",
      },
    };
  }
}

// ============================================
// Webhook Verification
// ============================================

/**
 * 웹훅 서명 검증
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const config = getTossConfig();
  if (!config.webhookSecret) {
    return false;
  }

  const expectedSignature = createHmac("sha256", config.webhookSecret)
    .update(payload)
    .digest("base64");

  return signature === expectedSignature;
}

// ============================================
// Payment URL Generation
// ============================================

/**
 * 결제 위젯용 데이터 생성
 */
export function generatePaymentWidgetData(request: PaymentRequest): {
  clientKey: string;
  orderId: string;
  amount: number;
  orderName: string;
  customerName?: string;
  customerEmail?: string;
  successUrl: string;
  failUrl: string;
} {
  const config = getTossConfig();

  return {
    clientKey: config.clientKey,
    orderId: request.orderId,
    amount: request.amount,
    orderName: request.orderName,
    customerName: request.customerName,
    customerEmail: request.customerEmail,
    successUrl: request.successUrl,
    failUrl: request.failUrl,
  };
}
