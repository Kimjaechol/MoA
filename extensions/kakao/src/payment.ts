/**
 * Payment Integration (Toss Payments + Supabase)
 *
 * Handles credit purchases via Toss Payments API.
 * https://docs.tosspayments.com/
 */

import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import { hashUserId, addCredits, getOrCreateUser } from "./billing.js";

export interface PaymentConfig {
  clientKey: string;
  secretKey: string;
  successUrl: string;
  failUrl: string;
}

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number; // KRW
  bonus?: number;
}

// Available credit packages
export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "basic", name: "기본", credits: 5000, price: 5000 },
  { id: "standard", name: "표준", credits: 10000, price: 10000, bonus: 2000 },
  { id: "premium", name: "프리미엄", credits: 20000, price: 20000, bonus: 10000 },
  { id: "pro", name: "프로", credits: 50000, price: 50000, bonus: 10000 },
];

export interface PaymentSession {
  id: string;
  orderId: string;
  userId: string;
  packageId: string;
  amount: number;
  credits: number;
  status: "pending" | "completed" | "failed" | "cancelled" | "refunded";
  paymentKey?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  status: string;
  totalAmount: number;
  method: string;
  approvedAt?: string;
  receipt?: {
    url: string;
  };
  failure?: {
    code: string;
    message: string;
  };
}

/**
 * Get payment configuration from environment
 */
function getPaymentConfig(): PaymentConfig | null {
  const clientKey = process.env.TOSS_CLIENT_KEY;
  const secretKey = process.env.TOSS_SECRET_KEY;
  const baseUrl = process.env.LAWCALL_BASE_URL ?? "https://lawcall.com";

  if (!clientKey || !secretKey) {
    return null;
  }

  return {
    clientKey,
    secretKey,
    successUrl: `${baseUrl}/payment/success`,
    failUrl: `${baseUrl}/payment/fail`,
  };
}

/**
 * Check if payments are configured
 */
export function isPaymentConfigured(): boolean {
  return getPaymentConfig() !== null;
}

/**
 * Generate unique order ID
 */
function generateOrderId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `LC${timestamp}${random}`.toUpperCase();
}

/**
 * Create a payment session for credit purchase
 */
export async function createPaymentSession(
  kakaoUserId: string,
  packageId: string,
): Promise<{ session: PaymentSession; paymentUrl: string } | { error: string }> {
  const config = getPaymentConfig();
  if (!config) {
    return { error: "결제 시스템이 설정되지 않았습니다. 관리자에게 문의해주세요." };
  }

  const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
  if (!pkg) {
    return { error: "유효하지 않은 패키지입니다." };
  }

  const user = await getOrCreateUser(kakaoUserId);
  const orderId = generateOrderId();
  const totalCredits = pkg.credits + (pkg.bonus ?? 0);

  // Save payment session to database
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();

    const { error: insertError } = await supabase.from("lawcall_payments").insert({
      order_id: orderId,
      user_id: user.id,
      package_id: packageId,
      amount: pkg.price,
      credits: totalCredits,
      status: "pending",
    });

    if (insertError) {
      console.error(`[payment] Failed to create session: ${insertError.message}`);
      return { error: "결제 세션 생성에 실패했습니다." };
    }
  }

  // Build Toss Payments checkout URL
  const orderName = `LawCall 크레딧 ${pkg.name} (${totalCredits.toLocaleString()} 크레딧)`;

  const params = new URLSearchParams({
    amount: pkg.price.toString(),
    orderId,
    orderName,
    successUrl: `${config.successUrl}?orderId=${orderId}`,
    failUrl: `${config.failUrl}?orderId=${orderId}`,
    customerKey: hashUserId(kakaoUserId),
  });

  // Toss Payments widget URL
  const paymentUrl = `https://pay.toss.im/v2/checkout?clientKey=${config.clientKey}&${params}`;

  const session: PaymentSession = {
    id: orderId,
    orderId,
    userId: user.id,
    packageId,
    amount: pkg.price,
    credits: totalCredits,
    status: "pending",
    createdAt: new Date(),
  };

  return { session, paymentUrl };
}

/**
 * Confirm payment after successful checkout
 */
export async function confirmPayment(
  orderId: string,
  paymentKey: string,
  amount: number,
): Promise<{
  success: boolean;
  credits?: number;
  newBalance?: number;
  error?: string;
  receiptUrl?: string;
}> {
  const config = getPaymentConfig();
  if (!config) {
    return { success: false, error: "결제 시스템 오류" };
  }

  // Get payment session from database
  if (!isSupabaseConfigured()) {
    return { success: false, error: "데이터베이스 연결 오류" };
  }

  const supabase = getSupabase();

  // Verify payment session
  const { data: payment, error: fetchError } = await supabase
    .from("lawcall_payments")
    .select("*, lawcall_users!inner(kakao_user_id)")
    .eq("order_id", orderId)
    .single();

  if (fetchError || !payment) {
    return { success: false, error: "결제 세션을 찾을 수 없습니다." };
  }

  if (payment.status !== "pending") {
    return { success: false, error: `결제가 이미 처리되었습니다. (상태: ${payment.status})` };
  }

  if (payment.amount !== amount) {
    return { success: false, error: "결제 금액이 일치하지 않습니다." };
  }

  try {
    // Confirm payment with Toss API
    const response = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount,
      }),
    });

    const tossResponse: TossPaymentResponse = await response.json();

    if (!response.ok || tossResponse.failure) {
      // Update payment as failed
      await supabase
        .from("lawcall_payments")
        .update({
          status: "failed",
          toss_response: tossResponse,
        })
        .eq("order_id", orderId);

      return {
        success: false,
        error: tossResponse.failure?.message ?? "결제 확인 실패",
      };
    }

    // Use atomic function to complete payment and add credits
    const { data: completionData, error: completionError } = await supabase.rpc("complete_payment", {
      p_order_id: orderId,
      p_payment_key: paymentKey,
      p_toss_response: tossResponse,
    });

    if (completionError) {
      console.error(`[payment] Failed to complete payment: ${completionError.message}`);
      return { success: false, error: "크레딧 추가에 실패했습니다." };
    }

    const result = completionData?.[0];

    return {
      success: true,
      credits: result?.credits_added ?? payment.credits,
      newBalance: result?.new_balance,
      receiptUrl: tossResponse.receipt?.url,
    };
  } catch (err) {
    console.error(`[payment] Error confirming payment: ${err}`);
    return { success: false, error: "결제 처리 중 오류가 발생했습니다." };
  }
}

/**
 * Get payment session by order ID
 */
export async function getPaymentSession(orderId: string): Promise<PaymentSession | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("lawcall_payments")
    .select("*")
    .eq("order_id", orderId)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    orderId: data.order_id,
    userId: data.user_id,
    packageId: data.package_id,
    amount: data.amount,
    credits: data.credits,
    status: data.status as PaymentSession["status"],
    paymentKey: data.payment_key ?? undefined,
    createdAt: new Date(data.created_at),
    completedAt: data.completed_at ? new Date(data.completed_at) : undefined,
  };
}

/**
 * Cancel pending payment
 */
export async function cancelPayment(orderId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from("lawcall_payments")
    .update({ status: "cancelled" })
    .eq("order_id", orderId)
    .eq("status", "pending");

  return !error;
}

/**
 * Request refund for completed payment
 */
export async function requestRefund(
  orderId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const config = getPaymentConfig();
  if (!config) {
    return { success: false, error: "결제 시스템 오류" };
  }

  if (!isSupabaseConfigured()) {
    return { success: false, error: "데이터베이스 연결 오류" };
  }

  const supabase = getSupabase();

  // Get payment
  const { data: payment, error: fetchError } = await supabase
    .from("lawcall_payments")
    .select("*")
    .eq("order_id", orderId)
    .single();

  if (fetchError || !payment || !payment.payment_key) {
    return { success: false, error: "결제 정보를 찾을 수 없습니다." };
  }

  if (payment.status !== "completed") {
    return { success: false, error: "완료된 결제만 환불할 수 있습니다." };
  }

  try {
    // Request refund from Toss
    const response = await fetch(
      `https://api.tosspayments.com/v1/payments/${payment.payment_key}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cancelReason: reason,
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json();
      return { success: false, error: errorData.message ?? "환불 요청 실패" };
    }

    // Update payment status and deduct credits
    await supabase
      .from("lawcall_payments")
      .update({ status: "refunded" })
      .eq("order_id", orderId);

    // Deduct the refunded credits (negative add)
    const hashedUserId = await supabase
      .from("lawcall_users")
      .select("kakao_user_id")
      .eq("id", payment.user_id)
      .single();

    if (hashedUserId.data) {
      await addCredits(hashedUserId.data.kakao_user_id, -payment.credits);
    }

    return { success: true };
  } catch (err) {
    console.error(`[payment] Error requesting refund: ${err}`);
    return { success: false, error: "환불 처리 중 오류가 발생했습니다." };
  }
}

/**
 * Get user's payment history
 */
export async function getPaymentHistory(
  kakaoUserId: string,
  limit: number = 10,
): Promise<PaymentSession[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const user = await getOrCreateUser(kakaoUserId);
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("lawcall_payments")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  return data.map(p => ({
    id: p.id,
    orderId: p.order_id,
    userId: p.user_id,
    packageId: p.package_id,
    amount: p.amount,
    credits: p.credits,
    status: p.status as PaymentSession["status"],
    paymentKey: p.payment_key ?? undefined,
    createdAt: new Date(p.created_at),
    completedAt: p.completed_at ? new Date(p.completed_at) : undefined,
  }));
}

/**
 * Generate credit package selection message for KakaoTalk
 */
export function getPackageSelectionMessage(): string {
  const lines = ["💳 크레딧 충전\n"];

  for (const pkg of CREDIT_PACKAGES) {
    const totalCredits = pkg.credits + (pkg.bonus ?? 0);
    const bonusText = pkg.bonus ? ` (+${pkg.bonus.toLocaleString()} 보너스!)` : "";
    lines.push(`${pkg.name}: ${totalCredits.toLocaleString()} 크레딧 - ${pkg.price.toLocaleString()}원${bonusText}`);
  }

  lines.push("\n원하시는 패키지를 선택해주세요:");
  lines.push('"기본 충전", "표준 충전", "프리미엄 충전", "프로 충전"');

  return lines.join("\n");
}

/**
 * Parse package selection from user message
 */
export function parsePackageSelection(message: string): CreditPackage | null {
  const normalized = message.toLowerCase().replace(/\s+/g, "");

  for (const pkg of CREDIT_PACKAGES) {
    if (normalized.includes(pkg.id) || normalized.includes(pkg.name)) {
      return pkg;
    }
  }

  // Try to match by price
  const priceMatch = message.match(/(\d+)원/);
  if (priceMatch) {
    const price = Number.parseInt(priceMatch[1], 10);
    return CREDIT_PACKAGES.find(p => p.price === price) ?? null;
  }

  return null;
}

/**
 * Check if message is a payment-related command
 */
export function isPaymentCommand(message: string): boolean {
  const paymentKeywords = ["충전", "결제", "크레딧", "구매", "패키지"];
  const normalized = message.toLowerCase();
  return paymentKeywords.some(kw => normalized.includes(kw));
}

/**
 * Check if user wants to set their own API key
 */
export function isApiKeyCommand(message: string): boolean {
  const apiKeyKeywords = ["api키", "api key", "apikey", "내 키", "나의 키", "키 등록", "키등록"];
  const normalized = message.toLowerCase().replace(/\s+/g, "");
  return apiKeyKeywords.some(kw => normalized.includes(kw.replace(/\s+/g, "")));
}

/**
 * Get API key registration guide
 */
export function getApiKeyGuide(): string {
  return `🔑 나만의 API 키 등록

API 키를 등록하면 무료로 이용할 수 있습니다!

📌 Anthropic (Claude)
1. console.anthropic.com 가입
2. API Keys 메뉴에서 키 생성
3. 여기에 키 입력: "anthropic sk-ant-..."

📌 OpenAI (GPT)
1. platform.openai.com 가입
2. API keys 메뉴에서 키 생성
3. 여기에 키 입력: "openai sk-..."

⚠️ 키는 AES-256으로 암호화되어 안전하게 저장됩니다.`;
}

/**
 * Parse API key from user message
 */
export function parseApiKey(message: string): {
  provider: "anthropic" | "openai";
  apiKey: string;
} | null {
  // Anthropic key pattern
  const anthropicMatch = message.match(/anthropic\s+(sk-ant-[a-zA-Z0-9_-]+)/i);
  if (anthropicMatch) {
    return { provider: "anthropic", apiKey: anthropicMatch[1] };
  }

  // OpenAI key pattern
  const openaiMatch = message.match(/openai\s+(sk-[a-zA-Z0-9_-]+)/i);
  if (openaiMatch) {
    return { provider: "openai", apiKey: openaiMatch[1] };
  }

  // Direct key patterns
  if (message.includes("sk-ant-")) {
    const match = message.match(/sk-ant-[a-zA-Z0-9_-]+/);
    if (match) return { provider: "anthropic", apiKey: match[0] };
  }

  if (message.match(/sk-[a-zA-Z0-9]{20,}/)) {
    const match = message.match(/sk-[a-zA-Z0-9_-]+/);
    if (match && !match[0].startsWith("sk-ant-")) {
      return { provider: "openai", apiKey: match[0] };
    }
  }

  return null;
}

/**
 * Validate API key by making a test request
 */
export async function validateApiKey(
  apiKey: string,
  provider: "anthropic" | "openai",
): Promise<{ valid: boolean; error?: string }> {
  try {
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      if (response.status === 401) {
        return { valid: false, error: "유효하지 않은 API 키입니다." };
      }

      return { valid: true };
    } else {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (response.status === 401) {
        return { valid: false, error: "유효하지 않은 API 키입니다." };
      }

      return { valid: true };
    }
  } catch (err) {
    return { valid: false, error: "API 키 검증 중 오류가 발생했습니다." };
  }
}
