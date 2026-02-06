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
  price: number; // 월 가격 (원)
  features: {
    maxDevices: number;
    commandsPerDay: number;
    memorySync: boolean;
    prioritySupport: boolean;
    customIntegration: boolean;
  };
  description: string;
}

export const SUBSCRIPTION_PLANS: Record<PlanType, SubscriptionPlan> = {
  free_trial: {
    type: "free_trial",
    name: "Free Trial",
    nameKo: "무료 체험",
    price: 0,
    features: {
      maxDevices: 2,
      commandsPerDay: 50,
      memorySync: true,
      prioritySupport: false,
      customIntegration: false,
    },
    description: "30일 무료 체험",
  },
  beta: {
    type: "beta",
    name: "Beta",
    nameKo: "베타",
    price: 0,
    features: {
      maxDevices: 5,
      commandsPerDay: 200,
      memorySync: true,
      prioritySupport: false,
      customIntegration: false,
    },
    description: "베타 기간 무료 사용",
  },
  basic: {
    type: "basic",
    name: "Basic",
    nameKo: "베이직",
    price: 9900,
    features: {
      maxDevices: 3,
      commandsPerDay: 100,
      memorySync: true,
      prioritySupport: false,
      customIntegration: false,
    },
    description: "개인 사용자용",
  },
  pro: {
    type: "pro",
    name: "Pro",
    nameKo: "프로",
    price: 29900,
    features: {
      maxDevices: 10,
      commandsPerDay: 500,
      memorySync: true,
      prioritySupport: true,
      customIntegration: false,
    },
    description: "전문가/소규모 팀용",
  },
  enterprise: {
    type: "enterprise",
    name: "Enterprise",
    nameKo: "엔터프라이즈",
    price: 99000,
    features: {
      maxDevices: 999,
      commandsPerDay: 9999,
      memorySync: true,
      prioritySupport: true,
      customIntegration: true,
    },
    description: "기업용 무제한",
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
 * 플랜 비교 표 생성
 */
export function formatPlanComparison(): string {
  const lines: string[] = [];

  lines.push("📋 **MoA 요금제**");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("");

  for (const plan of Object.values(SUBSCRIPTION_PLANS)) {
    if (plan.type === "beta") continue; // 베타는 표시 안함

    const priceText = plan.price === 0 ? "무료" : `${plan.price.toLocaleString()}원/월`;
    lines.push(`**${plan.nameKo}** - ${priceText}`);
    lines.push(`   ${plan.description}`);
    lines.push(`   • 디바이스 ${plan.features.maxDevices}대`);
    lines.push(`   • 하루 ${plan.features.commandsPerDay}회`);
    lines.push("");
  }

  lines.push("구독 시작: /구독 <플랜명>");
  lines.push("예: /구독 베이직");

  return lines.join("\n");
}
