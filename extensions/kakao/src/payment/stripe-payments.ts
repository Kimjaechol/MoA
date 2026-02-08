/**
 * Stripe 결제 연동 (글로벌)
 *
 * 한국 외 지역 사용자를 위한 Stripe 결제
 * - 카드 결제
 * - Link 간편결제 (원클릭)
 * - 구독 결제
 * - 다양한 결제 수단 (Apple Pay, Google Pay, etc.)
 *
 * 환경변수:
 * - STRIPE_SECRET_KEY: 시크릿 키 (서버용)
 * - STRIPE_PUBLISHABLE_KEY: 공개 키 (클라이언트용)
 * - STRIPE_WEBHOOK_SECRET: 웹훅 시크릿
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ============================================
// Configuration
// ============================================

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret?: string;
  /** 테스트 모드 여부 (키가 "sk_test_"로 시작) */
  testMode: boolean;
}

export function getStripeConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? "";

  // 테스트 키는 "_test_"가 포함됨
  const testMode = secretKey.includes("_test_") || publishableKey.includes("_test_");

  return {
    secretKey,
    publishableKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    testMode,
  };
}

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-12-18.acacia";

// ============================================
// Types
// ============================================

export type StripeCurrency = "usd" | "eur" | "gbp" | "jpy" | "krw" | "cny" | "sgd" | "aud" | "cad";

export interface StripeCustomer {
  id: string;
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}

export interface StripePaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: StripeCurrency;
  status: StripePaymentStatus;
  paymentMethod?: string;
  customer?: string;
  metadata?: Record<string, string>;
}

export type StripePaymentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

export interface StripeSubscription {
  id: string;
  customerId: string;
  status: StripeSubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  items: Array<{
    id: string;
    priceId: string;
    quantity: number;
  }>;
}

export type StripeSubscriptionStatus =
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "paused";

export interface CreatePaymentIntentRequest {
  amount: number;
  currency: StripeCurrency;
  customerId?: string;
  customerEmail?: string;
  description?: string;
  metadata?: Record<string, string>;
  /** Link 간편결제 활성화 */
  enableLink?: boolean;
  /** 자동 결제 수단 (card, link, apple_pay 등) */
  paymentMethodTypes?: string[];
  /** 성공 후 리다이렉트 URL */
  returnUrl?: string;
}

export interface CreateCheckoutSessionRequest {
  priceId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  mode: "payment" | "subscription";
  /** 무료 체험 기간 (일) */
  trialDays?: number;
  metadata?: Record<string, string>;
  /** Link 간편결제 허용 */
  allowLink?: boolean;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
  customerId?: string;
  subscriptionId?: string;
  paymentIntentId?: string;
  status: "open" | "complete" | "expired";
}

export interface StripePrice {
  id: string;
  productId: string;
  currency: StripeCurrency;
  unitAmount: number;
  recurring?: {
    interval: "day" | "week" | "month" | "year";
    intervalCount: number;
  };
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: unknown;
  };
  created: number;
}

// ============================================
// API Helpers
// ============================================

async function stripeRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<T> {
  const config = getStripeConfig();

  if (!config.secretKey) {
    throw new Error("STRIPE_SECRET_KEY가 설정되지 않았습니다.");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  };

  let bodyStr: string | undefined;
  if (body) {
    // Stripe API는 form-urlencoded를 사용
    bodyStr = buildFormData(body);
  }

  const response = await fetch(`${STRIPE_API_BASE}${endpoint}`, {
    method,
    headers,
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  const data = await response.json();

  if (!response.ok) {
    throw {
      code: data.error?.code ?? "UNKNOWN_ERROR",
      message: data.error?.message ?? "Stripe 요청 실패",
      type: data.error?.type,
    };
  }

  return data as T;
}

function buildFormData(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) {
      continue;
    }

    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (typeof value === "object" && !Array.isArray(value)) {
      parts.push(buildFormData(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "object") {
          parts.push(buildFormData(item as Record<string, unknown>, `${fullKey}[${index}]`));
        } else {
          parts.push(`${fullKey}[${index}]=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      parts.push(`${fullKey}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join("&");
}

// ============================================
// Customer Operations
// ============================================

/**
 * 고객 생성
 */
export async function createCustomer(params: {
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}): Promise<{
  success: boolean;
  customer?: StripeCustomer;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    }>("/customers", "POST", {
      email: params.email,
      name: params.name,
      metadata: params.metadata,
    });

    return {
      success: true,
      customer: {
        id: result.id,
        email: result.email,
        name: result.name,
        metadata: result.metadata,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CUSTOMER_CREATE_FAILED",
        message: err.message ?? "고객 생성 실패",
      },
    };
  }
}

/**
 * 고객 조회
 */
export async function getCustomer(customerId: string): Promise<{
  success: boolean;
  customer?: StripeCustomer;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      email?: string;
      name?: string;
      metadata?: Record<string, string>;
    }>(`/customers/${customerId}`, "GET");

    return {
      success: true,
      customer: {
        id: result.id,
        email: result.email,
        name: result.name,
        metadata: result.metadata,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CUSTOMER_GET_FAILED",
        message: err.message ?? "고객 조회 실패",
      },
    };
  }
}

/**
 * 이메일로 고객 검색 또는 생성
 */
export async function getOrCreateCustomer(
  email: string,
  name?: string,
): Promise<{
  success: boolean;
  customer?: StripeCustomer;
  created?: boolean;
  error?: { code: string; message: string };
}> {
  try {
    // 이메일로 기존 고객 검색
    const searchResult = await stripeRequest<{
      data: Array<{ id: string; email?: string; name?: string; metadata?: Record<string, string> }>;
    }>(`/customers?email=${encodeURIComponent(email)}&limit=1`, "GET");

    if (searchResult.data.length > 0) {
      return {
        success: true,
        customer: {
          id: searchResult.data[0].id,
          email: searchResult.data[0].email,
          name: searchResult.data[0].name,
          metadata: searchResult.data[0].metadata,
        },
        created: false,
      };
    }

    // 없으면 새로 생성
    const createResult = await createCustomer({ email, name });
    if (createResult.success) {
      return {
        success: true,
        customer: createResult.customer,
        created: true,
      };
    }

    return { success: false, error: createResult.error };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CUSTOMER_LOOKUP_FAILED",
        message: err.message ?? "고객 조회/생성 실패",
      },
    };
  }
}

// ============================================
// Payment Intent Operations
// ============================================

/**
 * PaymentIntent 생성 (Link 간편결제 포함)
 */
export async function createPaymentIntent(request: CreatePaymentIntentRequest): Promise<{
  success: boolean;
  paymentIntent?: StripePaymentIntent;
  error?: { code: string; message: string };
}> {
  try {
    // 기본 결제 수단에 Link 추가
    const paymentMethodTypes = request.paymentMethodTypes ?? ["card"];
    if (request.enableLink && !paymentMethodTypes.includes("link")) {
      paymentMethodTypes.push("link");
    }

    const params: Record<string, unknown> = {
      amount: request.amount,
      currency: request.currency,
      payment_method_types: paymentMethodTypes,
      metadata: request.metadata,
    };

    if (request.customerId) {
      params.customer = request.customerId;
    }
    if (request.description) {
      params.description = request.description;
    }
    if (request.returnUrl) {
      params.return_url = request.returnUrl;
    }

    // Link 결제를 위한 자동 결제 수단
    if (request.enableLink) {
      params.automatic_payment_methods = {
        enabled: true,
        allow_redirects: "always",
      };
      // payment_method_types와 automatic_payment_methods는 함께 사용 불가
      delete params.payment_method_types;
    }

    const result = await stripeRequest<{
      id: string;
      client_secret: string;
      amount: number;
      currency: string;
      status: StripePaymentStatus;
      payment_method?: string;
      customer?: string;
      metadata?: Record<string, string>;
    }>("/payment_intents", "POST", params);

    return {
      success: true,
      paymentIntent: {
        id: result.id,
        clientSecret: result.client_secret,
        amount: result.amount,
        currency: result.currency as StripeCurrency,
        status: result.status,
        paymentMethod: result.payment_method,
        customer: result.customer,
        metadata: result.metadata,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "PAYMENT_INTENT_FAILED",
        message: err.message ?? "결제 생성 실패",
      },
    };
  }
}

/**
 * PaymentIntent 조회
 */
export async function getPaymentIntent(paymentIntentId: string): Promise<{
  success: boolean;
  paymentIntent?: StripePaymentIntent;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      client_secret: string;
      amount: number;
      currency: string;
      status: StripePaymentStatus;
      payment_method?: string;
      customer?: string;
      metadata?: Record<string, string>;
    }>(`/payment_intents/${paymentIntentId}`, "GET");

    return {
      success: true,
      paymentIntent: {
        id: result.id,
        clientSecret: result.client_secret,
        amount: result.amount,
        currency: result.currency as StripeCurrency,
        status: result.status,
        paymentMethod: result.payment_method,
        customer: result.customer,
        metadata: result.metadata,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "PAYMENT_INTENT_GET_FAILED",
        message: err.message ?? "결제 조회 실패",
      },
    };
  }
}

/**
 * PaymentIntent 취소
 */
export async function cancelPaymentIntent(paymentIntentId: string): Promise<{
  success: boolean;
  paymentIntent?: StripePaymentIntent;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      client_secret: string;
      amount: number;
      currency: string;
      status: StripePaymentStatus;
    }>(`/payment_intents/${paymentIntentId}/cancel`, "POST");

    return {
      success: true,
      paymentIntent: {
        id: result.id,
        clientSecret: result.client_secret,
        amount: result.amount,
        currency: result.currency as StripeCurrency,
        status: result.status,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "PAYMENT_CANCEL_FAILED",
        message: err.message ?? "결제 취소 실패",
      },
    };
  }
}

// ============================================
// Checkout Session Operations
// ============================================

/**
 * Checkout Session 생성 (Link 간편결제 포함)
 */
export async function createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<{
  success: boolean;
  session?: StripeCheckoutSession;
  error?: { code: string; message: string };
}> {
  try {
    const paymentMethodTypes = ["card"];
    if (request.allowLink !== false) {
      paymentMethodTypes.push("link");
    }

    const params: Record<string, unknown> = {
      mode: request.mode,
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      payment_method_types: paymentMethodTypes,
      line_items: [
        {
          price: request.priceId,
          quantity: 1,
        },
      ],
      metadata: request.metadata,
      // Link 최적화 설정
      payment_method_options: {
        link: {
          persistent_token: true,
        },
      },
    };

    if (request.customerId) {
      params.customer = request.customerId;
    } else if (request.customerEmail) {
      params.customer_email = request.customerEmail;
    }

    // 무료 체험 기간 설정 (구독 모드만)
    if (request.mode === "subscription" && request.trialDays) {
      params.subscription_data = {
        trial_period_days: request.trialDays,
      };
    }

    const result = await stripeRequest<{
      id: string;
      url: string;
      customer?: string;
      subscription?: string;
      payment_intent?: string;
      status: "open" | "complete" | "expired";
    }>("/checkout/sessions", "POST", params);

    return {
      success: true,
      session: {
        id: result.id,
        url: result.url,
        customerId: result.customer,
        subscriptionId: result.subscription,
        paymentIntentId: result.payment_intent,
        status: result.status,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CHECKOUT_SESSION_FAILED",
        message: err.message ?? "결제 세션 생성 실패",
      },
    };
  }
}

/**
 * Checkout Session 조회
 */
export async function getCheckoutSession(sessionId: string): Promise<{
  success: boolean;
  session?: StripeCheckoutSession;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      url: string;
      customer?: string;
      subscription?: string;
      payment_intent?: string;
      status: "open" | "complete" | "expired";
    }>(`/checkout/sessions/${sessionId}`, "GET");

    return {
      success: true,
      session: {
        id: result.id,
        url: result.url,
        customerId: result.customer,
        subscriptionId: result.subscription,
        paymentIntentId: result.payment_intent,
        status: result.status,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "CHECKOUT_SESSION_GET_FAILED",
        message: err.message ?? "결제 세션 조회 실패",
      },
    };
  }
}

// ============================================
// Subscription Operations
// ============================================

/**
 * 구독 생성
 */
export async function createSubscription(params: {
  customerId: string;
  priceId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}): Promise<{
  success: boolean;
  subscription?: StripeSubscription;
  error?: { code: string; message: string };
}> {
  try {
    const reqParams: Record<string, unknown> = {
      customer: params.customerId,
      items: [{ price: params.priceId }],
      metadata: params.metadata,
      payment_behavior: "default_incomplete",
      payment_settings: {
        payment_method_types: ["card", "link"],
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
    };

    if (params.trialDays) {
      reqParams.trial_period_days = params.trialDays;
    }

    const result = await stripeRequest<{
      id: string;
      customer: string;
      status: StripeSubscriptionStatus;
      current_period_start: number;
      current_period_end: number;
      cancel_at_period_end: boolean;
      items: {
        data: Array<{
          id: string;
          price: { id: string };
          quantity: number;
        }>;
      };
    }>("/subscriptions", "POST", reqParams);

    return {
      success: true,
      subscription: {
        id: result.id,
        customerId: result.customer,
        status: result.status,
        currentPeriodStart: result.current_period_start,
        currentPeriodEnd: result.current_period_end,
        cancelAtPeriodEnd: result.cancel_at_period_end,
        items: result.items.data.map((item) => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity,
        })),
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "SUBSCRIPTION_CREATE_FAILED",
        message: err.message ?? "구독 생성 실패",
      },
    };
  }
}

/**
 * 구독 조회
 */
export async function getSubscription(subscriptionId: string): Promise<{
  success: boolean;
  subscription?: StripeSubscription;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      customer: string;
      status: StripeSubscriptionStatus;
      current_period_start: number;
      current_period_end: number;
      cancel_at_period_end: boolean;
      items: {
        data: Array<{
          id: string;
          price: { id: string };
          quantity: number;
        }>;
      };
    }>(`/subscriptions/${subscriptionId}`, "GET");

    return {
      success: true,
      subscription: {
        id: result.id,
        customerId: result.customer,
        status: result.status,
        currentPeriodStart: result.current_period_start,
        currentPeriodEnd: result.current_period_end,
        cancelAtPeriodEnd: result.cancel_at_period_end,
        items: result.items.data.map((item) => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity,
        })),
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "SUBSCRIPTION_GET_FAILED",
        message: err.message ?? "구독 조회 실패",
      },
    };
  }
}

/**
 * 구독 취소 (기간 종료 시)
 */
export async function cancelSubscription(
  subscriptionId: string,
  cancelImmediately = false,
): Promise<{
  success: boolean;
  subscription?: StripeSubscription;
  error?: { code: string; message: string };
}> {
  try {
    if (cancelImmediately) {
      const result = await stripeRequest<{
        id: string;
        customer: string;
        status: StripeSubscriptionStatus;
        current_period_start: number;
        current_period_end: number;
        cancel_at_period_end: boolean;
        items: { data: Array<{ id: string; price: { id: string }; quantity: number }> };
      }>(`/subscriptions/${subscriptionId}`, "DELETE");

      return {
        success: true,
        subscription: {
          id: result.id,
          customerId: result.customer,
          status: result.status,
          currentPeriodStart: result.current_period_start,
          currentPeriodEnd: result.current_period_end,
          cancelAtPeriodEnd: result.cancel_at_period_end,
          items: result.items.data.map((item) => ({
            id: item.id,
            priceId: item.price.id,
            quantity: item.quantity,
          })),
        },
      };
    }

    // 기간 종료 시 취소
    const result = await stripeRequest<{
      id: string;
      customer: string;
      status: StripeSubscriptionStatus;
      current_period_start: number;
      current_period_end: number;
      cancel_at_period_end: boolean;
      items: { data: Array<{ id: string; price: { id: string }; quantity: number }> };
    }>(`/subscriptions/${subscriptionId}`, "POST", {
      cancel_at_period_end: true,
    });

    return {
      success: true,
      subscription: {
        id: result.id,
        customerId: result.customer,
        status: result.status,
        currentPeriodStart: result.current_period_start,
        currentPeriodEnd: result.current_period_end,
        cancelAtPeriodEnd: result.cancel_at_period_end,
        items: result.items.data.map((item) => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity,
        })),
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "SUBSCRIPTION_CANCEL_FAILED",
        message: err.message ?? "구독 취소 실패",
      },
    };
  }
}

/**
 * 구독 재개 (취소 예정 취소)
 */
export async function resumeSubscription(subscriptionId: string): Promise<{
  success: boolean;
  subscription?: StripeSubscription;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      customer: string;
      status: StripeSubscriptionStatus;
      current_period_start: number;
      current_period_end: number;
      cancel_at_period_end: boolean;
      items: { data: Array<{ id: string; price: { id: string }; quantity: number }> };
    }>(`/subscriptions/${subscriptionId}`, "POST", {
      cancel_at_period_end: false,
    });

    return {
      success: true,
      subscription: {
        id: result.id,
        customerId: result.customer,
        status: result.status,
        currentPeriodStart: result.current_period_start,
        currentPeriodEnd: result.current_period_end,
        cancelAtPeriodEnd: result.cancel_at_period_end,
        items: result.items.data.map((item) => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity,
        })),
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "SUBSCRIPTION_RESUME_FAILED",
        message: err.message ?? "구독 재개 실패",
      },
    };
  }
}

// ============================================
// Refund Operations
// ============================================

/**
 * 환불 처리
 */
export async function createRefund(params: {
  paymentIntentId: string;
  amount?: number; // 부분 환불 시 금액
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
}): Promise<{
  success: boolean;
  refund?: { id: string; amount: number; status: string };
  error?: { code: string; message: string };
}> {
  try {
    const reqParams: Record<string, unknown> = {
      payment_intent: params.paymentIntentId,
    };

    if (params.amount) {
      reqParams.amount = params.amount;
    }
    if (params.reason) {
      reqParams.reason = params.reason;
    }

    const result = await stripeRequest<{
      id: string;
      amount: number;
      status: string;
    }>("/refunds", "POST", reqParams);

    return {
      success: true,
      refund: {
        id: result.id,
        amount: result.amount,
        status: result.status,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "REFUND_FAILED",
        message: err.message ?? "환불 처리 실패",
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
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  tolerance = 300, // 5분
): { valid: boolean; event?: StripeWebhookEvent; error?: string } {
  const config = getStripeConfig();

  if (!config.webhookSecret) {
    return { valid: false, error: "웹훅 시크릿이 설정되지 않았습니다." };
  }

  try {
    // 서명 헤더 파싱: t=timestamp,v1=signature
    const parts: Record<string, string> = {};
    for (const item of signature.split(",")) {
      const [key, value] = item.split("=");
      parts[key] = value;
    }

    const timestamp = parts.t;
    const v1Signature = parts.v1;

    if (!timestamp || !v1Signature) {
      return { valid: false, error: "잘못된 서명 형식입니다." };
    }

    // 타임스탬프 검증
    const now = Math.floor(Date.now() / 1000);
    if (now - parseInt(timestamp, 10) > tolerance) {
      return { valid: false, error: "서명이 만료되었습니다." };
    }

    // 서명 검증
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = createHmac("sha256", config.webhookSecret)
      .update(signedPayload)
      .digest("hex");

    const signatureBuffer = Buffer.from(v1Signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "서명이 일치하지 않습니다." };
    }

    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return { valid: false, error: "서명이 일치하지 않습니다." };
    }

    // 이벤트 파싱
    const event = JSON.parse(payload) as StripeWebhookEvent;

    return { valid: true, event };
  } catch {
    return { valid: false, error: "서명 검증 중 오류가 발생했습니다." };
  }
}

// ============================================
// Price/Product Helpers
// ============================================

/**
 * 가격 정보 조회
 */
export async function getPrice(priceId: string): Promise<{
  success: boolean;
  price?: StripePrice;
  error?: { code: string; message: string };
}> {
  try {
    const result = await stripeRequest<{
      id: string;
      product: string;
      currency: string;
      unit_amount: number;
      recurring?: {
        interval: "day" | "week" | "month" | "year";
        interval_count: number;
      };
    }>(`/prices/${priceId}`, "GET");

    return {
      success: true,
      price: {
        id: result.id,
        productId: result.product,
        currency: result.currency as StripeCurrency,
        unitAmount: result.unit_amount,
        recurring: result.recurring
          ? {
              interval: result.recurring.interval,
              intervalCount: result.recurring.interval_count,
            }
          : undefined,
      },
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "PRICE_GET_FAILED",
        message: err.message ?? "가격 조회 실패",
      },
    };
  }
}

// ============================================
// Link Payment Helper
// ============================================

/**
 * Link 간편결제 URL 생성
 */
export async function createLinkPaymentUrl(params: {
  amount: number;
  currency: StripeCurrency;
  customerEmail: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<{
  success: boolean;
  url?: string;
  sessionId?: string;
  error?: { code: string; message: string };
}> {
  try {
    // Payment Links API 사용
    const result = await stripeRequest<{
      id: string;
      url: string;
    }>("/payment_links", "POST", {
      line_items: [
        {
          price_data: {
            currency: params.currency,
            product_data: {
              name: params.description,
            },
            unit_amount: params.amount,
          },
          quantity: 1,
        },
      ],
      after_completion: {
        type: "redirect",
        redirect: {
          url: params.successUrl,
        },
      },
      metadata: params.metadata,
      payment_method_types: ["card", "link"],
    });

    return {
      success: true,
      url: result.url,
      sessionId: result.id,
    };
  } catch (error) {
    const err = error as { code: string; message: string };
    return {
      success: false,
      error: {
        code: err.code ?? "LINK_PAYMENT_FAILED",
        message: err.message ?? "Link 결제 URL 생성 실패",
      },
    };
  }
}

// ============================================
// Currency Helpers
// ============================================

/**
 * 통화별 최소 금액 (센트/전 단위)
 */
export const CURRENCY_MINIMUM: Record<StripeCurrency, number> = {
  usd: 50, // $0.50
  eur: 50, // €0.50
  gbp: 30, // £0.30
  jpy: 50, // ¥50
  krw: 1000, // ₩1000
  cny: 400, // ¥4.00
  sgd: 50, // $0.50 SGD
  aud: 50, // $0.50 AUD
  cad: 50, // $0.50 CAD
};

/**
 * 통화별 소수점 자릿수 (0 = 정수 통화)
 */
export const CURRENCY_DECIMALS: Record<StripeCurrency, number> = {
  usd: 2,
  eur: 2,
  gbp: 2,
  jpy: 0, // 일본 엔은 정수
  krw: 0, // 한국 원은 정수
  cny: 2,
  sgd: 2,
  aud: 2,
  cad: 2,
};

/**
 * 표시 금액을 Stripe 금액으로 변환
 */
export function toStripeAmount(displayAmount: number, currency: StripeCurrency): number {
  const decimals = CURRENCY_DECIMALS[currency];
  return Math.round(displayAmount * Math.pow(10, decimals));
}

/**
 * Stripe 금액을 표시 금액으로 변환
 */
export function fromStripeAmount(stripeAmount: number, currency: StripeCurrency): number {
  const decimals = CURRENCY_DECIMALS[currency];
  return stripeAmount / Math.pow(10, decimals);
}
