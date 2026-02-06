/**
 * MoA 구독 서비스 모델
 *
 * - 베타 기간: 무료
 * - 정식 출시 후: 30일 무료 체험 → 월 9,900원
 * - 크레딧 기반 추가 과금
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import { hashUserId } from "../billing.js";

// ============================================
// 구독 플랜 정의
// ============================================

export type PlanType = "free_trial" | "beta" | "basic" | "pro" | "enterprise";

export interface SubscriptionPlan {
  type: PlanType;
  name: string;
  nameKo: string;
  /** 월 가격 (원) */
  price: number;
  /** 월 가격 (USD 센트 단위) */
  priceUsd: number;
  features: {
    maxDevices: number;
    commandsPerDay: number;
    memorySync: boolean;
    prioritySupport: boolean;
    customIntegration: boolean;
  };
  description: string;
  descriptionEn: string;
}

export const SUBSCRIPTION_PLANS: Record<PlanType, SubscriptionPlan> = {
  free_trial: {
    type: "free_trial",
    name: "Free Trial",
    nameKo: "무료 체험",
    price: 0,
    priceUsd: 0,
    features: {
      maxDevices: 2,
      commandsPerDay: 50,
      memorySync: true,
      prioritySupport: false,
      customIntegration: false,
    },
    description: "30일 무료 체험",
    descriptionEn: "30-day free trial",
  },
  beta: {
    type: "beta",
    name: "Beta",
    nameKo: "베타",
    price: 0,
    priceUsd: 0,
    features: {
      maxDevices: 2,
      commandsPerDay: 50,
      memorySync: true,
      prioritySupport: false,
      customIntegration: false,
    },
    description: "베타 기간 무료 사용",
    descriptionEn: "Free during beta period",
  },
  basic: {
    type: "basic",
    name: "Basic",
    nameKo: "베이직",
    price: 11000, // ₩11,000 (약 $11)
    priceUsd: 1100, // $11.00 (센트 단위)
    features: {
      maxDevices: 2,
      commandsPerDay: 100,
      memorySync: true,
      prioritySupport: false,
      customIntegration: false,
    },
    description: "개인 사용자용",
    descriptionEn: "For personal use",
  },
  pro: {
    type: "pro",
    name: "Pro",
    nameKo: "프로",
    price: 22000, // ₩22,000 (약 $22)
    priceUsd: 2200, // $22.00 (센트 단위)
    features: {
      maxDevices: 5,
      commandsPerDay: 500,
      memorySync: true,
      prioritySupport: true,
      customIntegration: false,
    },
    description: "전문가/소규모 팀용",
    descriptionEn: "For professionals and small teams",
  },
  enterprise: {
    type: "enterprise",
    name: "Enterprise",
    nameKo: "엔터프라이즈",
    price: 220000, // ₩220,000 (약 $220)
    priceUsd: 22000, // $220.00 (센트 단위)
    features: {
      maxDevices: 10,
      commandsPerDay: 99999,
      memorySync: true,
      prioritySupport: true,
      customIntegration: true,
    },
    description: "기업용 (10대, 무제한 명령)",
    descriptionEn: "For enterprises (10 devices, unlimited commands)",
  },
};

// ============================================
// 구독 상태 관리
// ============================================

export interface UserSubscription {
  userId: string;
  plan: PlanType;
  status: "active" | "expired" | "cancelled" | "past_due";
  startDate: Date;
  endDate: Date | null;
  trialEndsAt: Date | null;
  autoRenew: boolean;
  paymentMethod: string | null;
}

/**
 * 현재 베타 기간인지 확인
 */
export function isBetaPeriod(): boolean {
  // 환경변수로 베타 종료일 설정 가능
  const betaEndDate = process.env.MOA_BETA_END_DATE;
  if (!betaEndDate) return true; // 기본적으로 베타

  return new Date() < new Date(betaEndDate);
}

/**
 * 사용자 구독 정보 조회
 */
export async function getUserSubscription(kakaoUserId: string): Promise<UserSubscription | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  const { data } = await supabase
    .from("moa_subscriptions")
    .select("*")
    .eq("user_id", hashedId)
    .single();

  if (!data) {
    // 신규 사용자 - 베타 기간이면 beta 플랜, 아니면 free_trial
    return {
      userId: hashedId,
      plan: isBetaPeriod() ? "beta" : "free_trial",
      status: "active",
      startDate: new Date(),
      endDate: null,
      trialEndsAt: isBetaPeriod() ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      autoRenew: false,
      paymentMethod: null,
    };
  }

  return {
    userId: data.user_id,
    plan: data.plan as PlanType,
    status: data.status,
    startDate: new Date(data.start_date),
    endDate: data.end_date ? new Date(data.end_date) : null,
    trialEndsAt: data.trial_ends_at ? new Date(data.trial_ends_at) : null,
    autoRenew: data.auto_renew,
    paymentMethod: data.payment_method,
  };
}

/**
 * 구독 생성 또는 업데이트
 */
export async function createOrUpdateSubscription(
  kakaoUserId: string,
  plan: PlanType,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버 설정 오류" };
  }

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  const subscriptionData = {
    user_id: hashedId,
    plan,
    status: "active",
    start_date: new Date().toISOString(),
    end_date: plan === "beta" ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    trial_ends_at: plan === "free_trial" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
    auto_renew: false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("moa_subscriptions")
    .upsert(subscriptionData, { onConflict: "user_id" });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 구독 제한 확인
 */
export async function checkSubscriptionLimits(
  kakaoUserId: string,
  action: "add_device" | "send_command",
): Promise<{
  allowed: boolean;
  reason?: string;
  upgrade?: PlanType;
}> {
  const subscription = await getUserSubscription(kakaoUserId);
  if (!subscription) {
    return { allowed: false, reason: "구독 정보를 찾을 수 없습니다." };
  }

  const plan = SUBSCRIPTION_PLANS[subscription.plan];
  if (!plan) {
    return { allowed: false, reason: "알 수 없는 플랜입니다." };
  }

  // 무료 체험 만료 확인
  if (subscription.plan === "free_trial" && subscription.trialEndsAt) {
    if (new Date() > subscription.trialEndsAt) {
      return {
        allowed: false,
        reason: "무료 체험 기간이 만료되었습니다. 구독을 시작해주세요.",
        upgrade: "basic",
      };
    }
  }

  // 상태 확인
  if (subscription.status !== "active") {
    return {
      allowed: false,
      reason: "구독이 만료되었거나 취소되었습니다.",
      upgrade: "basic",
    };
  }

  // 액션별 제한 확인
  if (action === "add_device") {
    // 디바이스 수 확인은 별도 쿼리 필요
    // 여기서는 플랜 정보만 반환
    return { allowed: true };
  }

  if (action === "send_command") {
    // 일일 명령 수 확인은 별도 쿼리 필요
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * 구독 상태 포맷 (카카오톡 표시용)
 */
export function formatSubscriptionStatus(subscription: UserSubscription): string {
  const plan = SUBSCRIPTION_PLANS[subscription.plan];
  const lines: string[] = [];

  lines.push("💳 **나의 MoA 구독**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");

  // 플랜 정보
  if (subscription.plan === "beta") {
    lines.push(`🎉 베타 테스터 (무료)`);
    lines.push(`   베타 기간 동안 모든 기능 무료 이용!`);
  } else if (subscription.plan === "free_trial") {
    const daysLeft = subscription.trialEndsAt
      ? Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : 0;
    lines.push(`🆓 무료 체험 중 (${daysLeft}일 남음)`);
    lines.push(`   체험 후 월 ${plan.price.toLocaleString()}원`);
  } else {
    lines.push(`${plan.nameKo} 플랜 - 월 ${plan.price.toLocaleString()}원`);
    const statusText = subscription.status === "active" ? "활성" : "만료";
    lines.push(`   상태: ${statusText}`);
  }

  lines.push("");
  lines.push("📊 포함 기능:");
  lines.push(`   • 최대 ${plan.features.maxDevices}대 디바이스`);
  lines.push(`   • 하루 ${plan.features.commandsPerDay}회 명령`);
  lines.push(`   • 메모리 동기화 ${plan.features.memorySync ? "✅" : "❌"}`);
  if (plan.features.prioritySupport) {
    lines.push(`   • 우선 지원 ✅`);
  }

  if (subscription.plan === "free_trial" || subscription.plan === "beta") {
    lines.push("");
    lines.push("💡 정식 구독: /구독");
  }

  return lines.join("\n");
}

/**
 * 플랜 비교 표 생성 (한국어)
 */
export function formatPlanComparison(): string {
  const lines: string[] = [];

  lines.push("📋 **MoA 요금제**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
    if (plan.type === "beta") continue; // 베타는 표시 안함

    const priceText = plan.price === 0 ? "무료 (30일)" : `₩${plan.price.toLocaleString()}/월`;
    const deviceText = `${plan.features.maxDevices}대`;
    const commandText = plan.features.commandsPerDay >= 99999 ? "무제한" : `${plan.features.commandsPerDay}회`;

    lines.push(`**${plan.nameKo}** - ${priceText}`);
    lines.push(`   ${plan.description}`);
    lines.push(`   • 디바이스 ${deviceText}`);
    lines.push(`   • 하루 ${commandText}`);
    if (plan.features.prioritySupport) {
      lines.push(`   • 우선 지원 ✅`);
    }
    lines.push("");
  }

  lines.push("⚡ MoA 제공 LLM API 사용 시 크레딧 선구매 필요");
  lines.push("");
  lines.push("구독 시작: /구독 <플랜명>");
  lines.push("예: /구독 베이직");

  return lines.join("\n");
}

/**
 * 플랜 비교 표 생성 (영어/글로벌)
 */
export function formatPlanComparisonEn(): string {
  const lines: string[] = [];

  lines.push("📋 **MoA Pricing Plans**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
    if (plan.type === "beta") continue;

    const priceText = plan.priceUsd === 0 ? "Free (30 days)" : `$${(plan.priceUsd / 100).toFixed(0)}/mo`;
    const deviceText = `${plan.features.maxDevices}`;
    const commandText = plan.features.commandsPerDay >= 99999 ? "Unlimited" : `${plan.features.commandsPerDay}`;

    lines.push(`**${plan.name}** - ${priceText}`);
    lines.push(`   ${plan.descriptionEn}`);
    lines.push(`   • Devices: ${deviceText}`);
    lines.push(`   • Commands/day: ${commandText}`);
    if (plan.features.prioritySupport) {
      lines.push(`   • Priority support ✅`);
    }
    lines.push("");
  }

  lines.push("⚡ LLM API usage requires pre-purchased credits");
  lines.push("");
  lines.push("Subscribe: /subscribe <plan>");
  lines.push("Example: /subscribe basic");

  return lines.join("\n");
}

// ============================================
// LLM 크레딧 시스템
// ============================================

export interface CreditPackage {
  id: string;
  name: string;
  nameKo: string;
  credits: number;
  priceKrw: number;
  priceUsd: number; // 센트 단위
  bonus?: number; // 보너스 크레딧
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "credits_1000",
    name: "1,000 Credits",
    nameKo: "1,000 크레딧",
    credits: 1000,
    priceKrw: 5000,
    priceUsd: 500,
  },
  {
    id: "credits_5000",
    name: "5,000 Credits",
    nameKo: "5,000 크레딧",
    credits: 5000,
    priceKrw: 22000,
    priceUsd: 2200,
    bonus: 500, // 10% 보너스
  },
  {
    id: "credits_10000",
    name: "10,000 Credits",
    nameKo: "10,000 크레딧",
    credits: 10000,
    priceKrw: 40000,
    priceUsd: 4000,
    bonus: 1500, // 15% 보너스
  },
  {
    id: "credits_50000",
    name: "50,000 Credits",
    nameKo: "50,000 크레딧",
    credits: 50000,
    priceKrw: 180000,
    priceUsd: 18000,
    bonus: 10000, // 20% 보너스
  },
];

// LLM 모델별 크레딧 소비량
export const LLM_CREDIT_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 1, output: 3 }, // 1K 토큰당
  "gpt-4o-mini": { input: 0.1, output: 0.3 },
  "claude-3-5-sonnet": { input: 1.2, output: 3.6 },
  "claude-3-5-haiku": { input: 0.3, output: 0.9 },
  "gemini-2.0-flash": { input: 0.1, output: 0.3 },
};

export interface UserCredits {
  userId: string;
  balance: number;
  totalPurchased: number;
  totalUsed: number;
  lastUpdated: Date;
}

/**
 * 사용자 크레딧 조회
 */
export async function getUserCredits(kakaoUserId: string): Promise<UserCredits | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  const { data } = await supabase
    .from("moa_credits")
    .select("*")
    .eq("user_id", hashedId)
    .single();

  if (!data) {
    return {
      userId: hashedId,
      balance: 0,
      totalPurchased: 0,
      totalUsed: 0,
      lastUpdated: new Date(),
    };
  }

  return {
    userId: data.user_id,
    balance: data.balance,
    totalPurchased: data.total_purchased,
    totalUsed: data.total_used,
    lastUpdated: new Date(data.updated_at),
  };
}

/**
 * 크레딧 추가 (구매 시)
 */
export async function addCredits(
  kakaoUserId: string,
  amount: number,
  reason: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버 설정 오류" };
  }

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  // 현재 잔액 조회
  const current = await getUserCredits(kakaoUserId);
  const newBalance = (current?.balance ?? 0) + amount;

  const { error } = await supabase
    .from("moa_credits")
    .upsert({
      user_id: hashedId,
      balance: newBalance,
      total_purchased: (current?.totalPurchased ?? 0) + amount,
      total_used: current?.totalUsed ?? 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (error) {
    return { success: false, error: error.message };
  }

  // 크레딧 변동 기록
  await supabase.from("moa_credit_history").insert({
    user_id: hashedId,
    amount,
    type: "purchase",
    reason,
    balance_after: newBalance,
    created_at: new Date().toISOString(),
  });

  return { success: true, newBalance };
}

/**
 * 크레딧 차감 (LLM 사용 시)
 */
export async function deductCredits(
  kakaoUserId: string,
  amount: number,
  reason: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버 설정 오류" };
  }

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  // 현재 잔액 조회
  const current = await getUserCredits(kakaoUserId);
  if (!current || current.balance < amount) {
    return { success: false, error: "크레딧이 부족합니다." };
  }

  const newBalance = current.balance - amount;

  const { error } = await supabase
    .from("moa_credits")
    .update({
      balance: newBalance,
      total_used: current.totalUsed + amount,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", hashedId);

  if (error) {
    return { success: false, error: error.message };
  }

  // 크레딧 변동 기록
  await supabase.from("moa_credit_history").insert({
    user_id: hashedId,
    amount: -amount,
    type: "usage",
    reason,
    balance_after: newBalance,
    created_at: new Date().toISOString(),
  });

  return { success: true, newBalance };
}

/**
 * 크레딧 패키지 비교 표시 (한국어)
 */
export function formatCreditPackages(): string {
  const lines: string[] = [];

  lines.push("💎 **MoA 크레딧 패키지**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("MoA 제공 LLM API 사용을 위한 크레딧");
  lines.push("");

  for (const pkg of CREDIT_PACKAGES) {
    const bonusText = pkg.bonus ? ` (+${pkg.bonus.toLocaleString()} 보너스!)` : "";
    lines.push(`📦 **${pkg.nameKo}** - ₩${pkg.priceKrw.toLocaleString()}`);
    lines.push(`   ${pkg.credits.toLocaleString()} 크레딧${bonusText}`);
    lines.push("");
  }

  lines.push("구매: /크레딧구매 <패키지명>");
  lines.push("예: /크레딧구매 5000");

  return lines.join("\n");
}

/**
 * 크레딧 패키지 비교 표시 (영어)
 */
export function formatCreditPackagesEn(): string {
  const lines: string[] = [];

  lines.push("💎 **MoA Credit Packages**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");
  lines.push("Credits for MoA-provided LLM APIs");
  lines.push("");

  for (const pkg of CREDIT_PACKAGES) {
    const bonusText = pkg.bonus ? ` (+${pkg.bonus.toLocaleString()} bonus!)` : "";
    lines.push(`📦 **${pkg.name}** - $${(pkg.priceUsd / 100).toFixed(0)}`);
    lines.push(`   ${pkg.credits.toLocaleString()} credits${bonusText}`);
    lines.push("");
  }

  lines.push("Purchase: /buy-credits <package>");
  lines.push("Example: /buy-credits 5000");

  return lines.join("\n");
}

// ============================================
// 결제 처리
// ============================================

export interface PaymentRecord {
  userId: string;
  orderId: string;
  paymentKey: string;
  provider: "toss" | "kakao" | "stripe";
  amount: number;
  status: "pending" | "completed" | "failed" | "refunded";
  planType: PlanType;
  /** 통화 (Stripe용) */
  currency?: string;
}

/**
 * 구독 상태 업데이트 (결제 완료 후)
 */
export async function updateSubscriptionStatus(
  kakaoUserId: string,
  plan: PlanType,
  paymentInfo: {
    paymentKey?: string;
    provider: "toss" | "kakao" | "stripe";
  },
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버 설정 오류" };
  }

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);
  const selectedPlan = SUBSCRIPTION_PLANS[plan];

  // 다음 결제일 계산 (1개월 후)
  const nextPaymentDate = new Date();
  nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

  const subscriptionData = {
    user_id: hashedId,
    plan,
    status: "active",
    start_date: new Date().toISOString(),
    end_date: nextPaymentDate.toISOString(),
    trial_ends_at: null, // 유료 전환 시 체험판 해제
    auto_renew: true,
    payment_method: paymentInfo.provider,
    payment_key: paymentInfo.paymentKey,
    monthly_price: selectedPlan.price,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("moa_subscriptions")
    .upsert(subscriptionData, { onConflict: "user_id" });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 결제 기록 저장
 */
export async function recordPayment(record: PaymentRecord): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버 설정 오류" };
  }

  const supabase = getSupabase();
  const hashedId = hashUserId(record.userId);

  const paymentData = {
    user_id: hashedId,
    order_id: record.orderId,
    payment_key: record.paymentKey,
    provider: record.provider,
    amount: record.amount,
    status: record.status,
    plan_type: record.planType,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("moa_payments").insert(paymentData);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * 결제 내역 조회
 */
export async function getPaymentHistory(
  kakaoUserId: string,
  limit = 10,
): Promise<PaymentRecord[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  const { data } = await supabase
    .from("moa_payments")
    .select("*")
    .eq("user_id", hashedId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row) => ({
    userId: row.user_id,
    orderId: row.order_id,
    paymentKey: row.payment_key,
    provider: row.provider,
    amount: row.amount,
    status: row.status,
    planType: row.plan_type,
  }));
}

/**
 * 결제 URL 생성
 */
export function generatePaymentUrl(params: {
  userId: string;
  plan: PlanType;
  provider: "toss" | "kakao";
}): { orderId: string; returnUrl: string } {
  const plan = SUBSCRIPTION_PLANS[params.plan];
  const timestamp = Date.now();
  const orderId = `moa_sub_${hashUserId(params.userId).slice(0, 8)}_${params.plan}_${timestamp}`;

  const baseUrl = process.env.MOA_BASE_URL ?? "https://moa.example.com";
  const successPath = params.provider === "toss" ? "/payment/toss/success" : "/payment/kakao/success";
  const failPath = params.provider === "toss" ? "/payment/toss/fail" : "/payment/kakao/fail";

  return {
    orderId,
    returnUrl: `${baseUrl}${successPath}?orderId=${orderId}`,
  };
}

/**
 * 구독 취소
 */
export async function cancelSubscription(
  kakaoUserId: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: "서버 설정 오류" };
  }

  const supabase = getSupabase();
  const hashedId = hashUserId(kakaoUserId);

  const { error } = await supabase
    .from("moa_subscriptions")
    .update({
      status: "cancelled",
      auto_renew: false,
      cancelled_at: new Date().toISOString(),
      cancel_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", hashedId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
