/**
 * 카카오페이 결제 연동
 *
 * 카카오페이 API를 통한 결제 처리
 * - 단건 결제
 * - 정기 결제 (구독)
 * - 결제 취소
 *
 * 환경변수:
 * - KAKAO_PAY_CID: 가맹점 코드
 * - KAKAO_PAY_SECRET: 시크릿 키
 * - KAKAO_PAY_ADMIN_KEY: Admin 키 (서버용)
 */

// ============================================
// Configuration
// ============================================

export interface KakaoPayConfig {
  /** 가맹점 코드 (테스트: TC0ONETIME, 정기: TCSUBSCRIP) */
  cid: string;
  /** Admin 키 */
  adminKey: string;
  /** 테스트 모드 여부 */
  testMode: boolean;
}

export function getKakaoPayConfig(): KakaoPayConfig {
  const cid = process.env.KAKAO_PAY_CID ?? "TC0ONETIME";
  const adminKey = process.env.KAKAO_PAY_ADMIN_KEY ?? process.env.KAKAO_ADMIN_KEY ?? "";

  // 테스트 CID는 "TC"로 시작
  const testMode = cid.startsWith("TC");

  return {
    cid,
    adminKey,
    testMode,
  };
}

const KAKAO_PAY_API_BASE = "https://kapi.kakao.com/v1/payment";

// ============================================
// Types
// ============================================

export interface KakaoPayReadyRequest {
  /** 가맹점 주문번호 (고유) */
  partnerOrderId: string;
  /** 가맹점 회원 ID */
  partnerUserId: string;
  /** 상품명 */
  itemName: string;
  /** 상품 수량 */
  quantity: number;
  /** 총 결제 금액 */
  totalAmount: number;
  /** 비과세 금액 */
  taxFreeAmount?: number;
  /** 결제 성공 시 리다이렉트 URL */
  approvalUrl: string;
  /** 결제 취소 시 리다이렉트 URL */
  cancelUrl: string;
  /** 결제 실패 시 리다이렉트 URL */
  failUrl: string;
}

export interface KakaoPayReadyResponse {
  success: boolean;
  /** 결제 고유 번호 */
  tid?: string;
  /** PC 웹 결제 URL */
  nextRedirectPcUrl?: string;
  /** 모바일 웹 결제 URL */
  nextRedirectMobileUrl?: string;
  /** 카카오톡 앱 결제 URL */
  nextRedirectAppUrl?: string;
  /** 결제 준비 유효 시간 */
  createdAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface KakaoPayApproveRequest {
  /** 결제 고유 번호 (ready에서 받은 tid) */
  tid: string;
  /** 가맹점 주문번호 */
  partnerOrderId: string;
  /** 가맹점 회원 ID */
  partnerUserId: string;
  /** 인증 완료 시 받은 pg_token */
  pgToken: string;
}

export interface KakaoPayApproveResponse {
  success: boolean;
  /** 결제 고유 번호 */
  tid?: string;
  /** 결제 수단 */
  paymentMethodType?: "CARD" | "MONEY";
  /** 결제 금액 */
  amount?: {
    total: number;
    taxFree: number;
    vat: number;
    point: number;
    discount: number;
  };
  /** 카드 정보 */
  cardInfo?: {
    purchaseCorp: string;
    purchaseCorpCode: string;
    issuerCorp: string;
    issuerCorpCode: string;
    kakaopayPurchaseCorp: string;
    kakaopayPurchaseCorpCode: string;
    kakaopayIssuerCorp: string;
    kakaopayIssuerCorpCode: string;
    bin: string;
    cardType: string;
    installMonth: string;
    approvedId: string;
    cardMid: string;
    interestFreeInstall: string;
    cardItemCode: string;
  };
  /** 결제 승인 시각 */
  approvedAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface KakaoPayCancelRequest {
  /** 결제 고유 번호 */
  tid: string;
  /** 취소 금액 */
  cancelAmount: number;
  /** 취소 비과세 금액 */
  cancelTaxFreeAmount?: number;
}

export interface KakaoPayCancelResponse {
  success: boolean;
  /** 결제 고유 번호 */
  tid?: string;
  /** 결제 상태 */
  status?: "CANCEL_PAYMENT" | "PART_CANCEL_PAYMENT";
  /** 취소된 금액 */
  canceledAmount?: {
    total: number;
    taxFree: number;
    vat: number;
    point: number;
    discount: number;
  };
  /** 취소 가능 금액 */
  cancelAvailableAmount?: {
    total: number;
    taxFree: number;
    vat: number;
    point: number;
    discount: number;
  };
  /** 취소 시각 */
  canceledAt?: string;
  error?: {
    code: string;
    message: string;
  };
}

// ============================================
// Subscription Types
// ============================================

export interface KakaoPaySubscriptionReadyRequest {
  /** 가맹점 주문번호 */
  partnerOrderId: string;
  /** 가맹점 회원 ID */
  partnerUserId: string;
  /** 상품명 */
  itemName: string;
  /** 상품 수량 */
  quantity: number;
  /** 총 결제 금액 (첫 결제) */
  totalAmount: number;
  /** 비과세 금액 */
  taxFreeAmount?: number;
  /** 결제 성공 시 리다이렉트 URL */
  approvalUrl: string;
  /** 결제 취소 시 리다이렉트 URL */
  cancelUrl: string;
  /** 결제 실패 시 리다이렉트 URL */
  failUrl: string;
}

export interface KakaoPaySubscriptionInfo {
  /** 정기 결제 SID */
  sid: string;
  /** 정기 결제 상태 */
  status: "ACTIVE" | "INACTIVE";
  /** 등록 시각 */
  createdAt: string;
  /** 마지막 승인 시각 */
  lastApprovedAt?: string;
}

export interface KakaoPaySubscriptionPaymentRequest {
  /** 정기 결제 SID */
  sid: string;
  /** 가맹점 주문번호 */
  partnerOrderId: string;
  /** 가맹점 회원 ID */
  partnerUserId: string;
  /** 상품명 */
  itemName: string;
  /** 상품 수량 */
  quantity: number;
  /** 결제 금액 */
  totalAmount: number;
  /** 비과세 금액 */
  taxFreeAmount?: number;
}

// ============================================
// API Helpers
// ============================================

async function kakaoPayRequest<T>(
  endpoint: string,
  body: Record<string, string | number>,
): Promise<T> {
  const config = getKakaoPayConfig();

  if (!config.adminKey) {
    throw new Error("KAKAO_PAY_ADMIN_KEY가 설정되지 않았습니다.");
  }

  // URLSearchParams로 form-urlencoded 전송
  const params = new URLSearchParams();
  params.append("cid", config.cid);
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      params.append(toSnakeCase(key), String(value));
    }
  }

  const response = await fetch(`${KAKAO_PAY_API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `KakaoAK ${config.adminKey}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: params.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw {
      code: data.code ?? "UNKNOWN_ERROR",
      message: data.msg ?? data.message ?? "결제 요청 실패",
    };
  }

  return data as T;
}

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function _fromSnakeCase<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = value;
  }
  return result as T;
}

// ============================================
// Payment Operations
// ============================================

/**
 * 결제 준비 (결제 URL 생성)
 */
export async function readyPayment(request: KakaoPayReadyRequest): Promise<KakaoPayReadyResponse> {
  try {
    const result = await kakaoPayRequest<{
      tid: string;
      next_redirect_pc_url: string;
      next_redirect_mobile_url: string;
      next_redirect_app_url: string;
      created_at: string;
    }>("/ready", {
      partnerOrderId: request.partnerOrderId,
      partnerUserId: request.partnerUserId,
      itemName: request.itemName,
      quantity: request.quantity,
      totalAmount: request.totalAmount,
      taxFreeAmount: request.taxFreeAmount ?? 0,
      approvalUrl: request.approvalUrl,
      cancelUrl: request.cancelUrl,
      failUrl: request.failUrl,
    });

    return {
      success: true,
      tid: result.tid,
      nextRedirectPcUrl: result.next_redirect_pc_url,
      nextRedirectMobileUrl: result.next_redirect_mobile_url,
      nextRedirectAppUrl: result.next_redirect_app_url,
      createdAt: result.created_at,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "READY_FAILED",
        message: err.message ?? "결제 준비 실패",
      },
    };
  }
}

/**
 * 결제 승인
 */
export async function approvePayment(
  request: KakaoPayApproveRequest,
): Promise<KakaoPayApproveResponse> {
  try {
    const result = await kakaoPayRequest<{
      tid: string;
      payment_method_type: "CARD" | "MONEY";
      amount: {
        total: number;
        tax_free: number;
        vat: number;
        point: number;
        discount: number;
      };
      card_info?: {
        purchase_corp: string;
        purchase_corp_code: string;
        issuer_corp: string;
        issuer_corp_code: string;
        kakaopay_purchase_corp: string;
        kakaopay_purchase_corp_code: string;
        kakaopay_issuer_corp: string;
        kakaopay_issuer_corp_code: string;
        bin: string;
        card_type: string;
        install_month: string;
        approved_id: string;
        card_mid: string;
        interest_free_install: string;
        card_item_code: string;
      };
      approved_at: string;
    }>("/approve", {
      tid: request.tid,
      partnerOrderId: request.partnerOrderId,
      partnerUserId: request.partnerUserId,
      pgToken: request.pgToken,
    });

    return {
      success: true,
      tid: result.tid,
      paymentMethodType: result.payment_method_type,
      amount: {
        total: result.amount.total,
        taxFree: result.amount.tax_free,
        vat: result.amount.vat,
        point: result.amount.point,
        discount: result.amount.discount,
      },
      cardInfo: result.card_info
        ? {
            purchaseCorp: result.card_info.purchase_corp,
            purchaseCorpCode: result.card_info.purchase_corp_code,
            issuerCorp: result.card_info.issuer_corp,
            issuerCorpCode: result.card_info.issuer_corp_code,
            kakaopayPurchaseCorp: result.card_info.kakaopay_purchase_corp,
            kakaopayPurchaseCorpCode: result.card_info.kakaopay_purchase_corp_code,
            kakaopayIssuerCorp: result.card_info.kakaopay_issuer_corp,
            kakaopayIssuerCorpCode: result.card_info.kakaopay_issuer_corp_code,
            bin: result.card_info.bin,
            cardType: result.card_info.card_type,
            installMonth: result.card_info.install_month,
            approvedId: result.card_info.approved_id,
            cardMid: result.card_info.card_mid,
            interestFreeInstall: result.card_info.interest_free_install,
            cardItemCode: result.card_info.card_item_code,
          }
        : undefined,
      approvedAt: result.approved_at,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "APPROVE_FAILED",
        message: err.message ?? "결제 승인 실패",
      },
    };
  }
}

/**
 * 결제 취소
 */
export async function cancelPayment(
  request: KakaoPayCancelRequest,
): Promise<KakaoPayCancelResponse> {
  try {
    const result = await kakaoPayRequest<{
      tid: string;
      status: "CANCEL_PAYMENT" | "PART_CANCEL_PAYMENT";
      canceled_amount: {
        total: number;
        tax_free: number;
        vat: number;
        point: number;
        discount: number;
      };
      cancel_available_amount: {
        total: number;
        tax_free: number;
        vat: number;
        point: number;
        discount: number;
      };
      canceled_at: string;
    }>("/cancel", {
      tid: request.tid,
      cancelAmount: request.cancelAmount,
      cancelTaxFreeAmount: request.cancelTaxFreeAmount ?? 0,
    });

    return {
      success: true,
      tid: result.tid,
      status: result.status,
      canceledAmount: {
        total: result.canceled_amount.total,
        taxFree: result.canceled_amount.tax_free,
        vat: result.canceled_amount.vat,
        point: result.canceled_amount.point,
        discount: result.canceled_amount.discount,
      },
      cancelAvailableAmount: {
        total: result.cancel_available_amount.total,
        taxFree: result.cancel_available_amount.tax_free,
        vat: result.cancel_available_amount.vat,
        point: result.cancel_available_amount.point,
        discount: result.cancel_available_amount.discount,
      },
      canceledAt: result.canceled_at,
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
// Subscription Operations
// ============================================

/**
 * 정기 결제 준비
 */
export async function readySubscription(
  request: KakaoPaySubscriptionReadyRequest,
): Promise<KakaoPayReadyResponse> {
  const config = getKakaoPayConfig();

  // 정기 결제용 CID (테스트: TCSUBSCRIP)
  const subscriptionCid = config.testMode
    ? "TCSUBSCRIP"
    : (process.env.KAKAO_PAY_SUBSCRIPTION_CID ?? config.cid);

  try {
    // 임시로 CID 변경
    const originalCid = config.cid;
    process.env.KAKAO_PAY_CID = subscriptionCid;

    const result = await kakaoPayRequest<{
      tid: string;
      next_redirect_pc_url: string;
      next_redirect_mobile_url: string;
      next_redirect_app_url: string;
      created_at: string;
    }>("/ready", {
      partnerOrderId: request.partnerOrderId,
      partnerUserId: request.partnerUserId,
      itemName: request.itemName,
      quantity: request.quantity,
      totalAmount: request.totalAmount,
      taxFreeAmount: request.taxFreeAmount ?? 0,
      approvalUrl: request.approvalUrl,
      cancelUrl: request.cancelUrl,
      failUrl: request.failUrl,
    });

    // CID 복원
    process.env.KAKAO_PAY_CID = originalCid;

    return {
      success: true,
      tid: result.tid,
      nextRedirectPcUrl: result.next_redirect_pc_url,
      nextRedirectMobileUrl: result.next_redirect_mobile_url,
      nextRedirectAppUrl: result.next_redirect_app_url,
      createdAt: result.created_at,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "SUBSCRIPTION_READY_FAILED",
        message: err.message ?? "정기 결제 준비 실패",
      },
    };
  }
}

/**
 * 정기 결제 SID로 결제 실행
 */
export async function chargeSubscription(
  request: KakaoPaySubscriptionPaymentRequest,
): Promise<KakaoPayApproveResponse> {
  const config = getKakaoPayConfig();
  const subscriptionCid = config.testMode
    ? "TCSUBSCRIP"
    : (process.env.KAKAO_PAY_SUBSCRIPTION_CID ?? config.cid);

  try {
    const originalCid = config.cid;
    process.env.KAKAO_PAY_CID = subscriptionCid;

    const result = await kakaoPayRequest<{
      tid: string;
      sid: string;
      payment_method_type: "CARD" | "MONEY";
      amount: {
        total: number;
        tax_free: number;
        vat: number;
        point: number;
        discount: number;
      };
      approved_at: string;
    }>("/subscription", {
      sid: request.sid,
      partnerOrderId: request.partnerOrderId,
      partnerUserId: request.partnerUserId,
      itemName: request.itemName,
      quantity: request.quantity,
      totalAmount: request.totalAmount,
      taxFreeAmount: request.taxFreeAmount ?? 0,
    });

    process.env.KAKAO_PAY_CID = originalCid;

    return {
      success: true,
      tid: result.tid,
      paymentMethodType: result.payment_method_type,
      amount: {
        total: result.amount.total,
        taxFree: result.amount.tax_free,
        vat: result.amount.vat,
        point: result.amount.point,
        discount: result.amount.discount,
      },
      approvedAt: result.approved_at,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "SUBSCRIPTION_CHARGE_FAILED",
        message: err.message ?? "정기 결제 실패",
      },
    };
  }
}

/**
 * 정기 결제 비활성화
 */
export async function inactivateSubscription(sid: string): Promise<{
  success: boolean;
  sid?: string;
  status?: string;
  inactivatedAt?: string;
  error?: { code: string; message: string };
}> {
  const config = getKakaoPayConfig();
  const subscriptionCid = config.testMode
    ? "TCSUBSCRIP"
    : (process.env.KAKAO_PAY_SUBSCRIPTION_CID ?? config.cid);

  try {
    const originalCid = config.cid;
    process.env.KAKAO_PAY_CID = subscriptionCid;

    const result = await kakaoPayRequest<{
      sid: string;
      status: string;
      inactivated_at: string;
    }>("/manage/subscription/inactive", {
      sid,
    });

    process.env.KAKAO_PAY_CID = originalCid;

    return {
      success: true,
      sid: result.sid,
      status: result.status,
      inactivatedAt: result.inactivated_at,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "INACTIVATE_FAILED",
        message: err.message ?? "정기 결제 비활성화 실패",
      },
    };
  }
}

/**
 * 정기 결제 상태 조회
 */
export async function getSubscriptionStatus(sid: string): Promise<{
  success: boolean;
  subscription?: KakaoPaySubscriptionInfo;
  error?: { code: string; message: string };
}> {
  const config = getKakaoPayConfig();
  const subscriptionCid = config.testMode
    ? "TCSUBSCRIP"
    : (process.env.KAKAO_PAY_SUBSCRIPTION_CID ?? config.cid);

  try {
    const originalCid = config.cid;
    process.env.KAKAO_PAY_CID = subscriptionCid;

    const result = await kakaoPayRequest<{
      sid: string;
      status: "ACTIVE" | "INACTIVE";
      created_at: string;
      last_approved_at?: string;
    }>("/manage/subscription/status", {
      sid,
    });

    process.env.KAKAO_PAY_CID = originalCid;

    return {
      success: true,
      subscription: {
        sid: result.sid,
        status: result.status,
        createdAt: result.created_at,
        lastApprovedAt: result.last_approved_at,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "STATUS_FAILED",
        message: err.message ?? "정기 결제 상태 조회 실패",
      },
    };
  }
}
