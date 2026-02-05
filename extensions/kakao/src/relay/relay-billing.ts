/**
 * Relay Billing
 *
 * Handles credit charging for relay commands.
 * Relay is a premium feature — users pay per command sent through the relay.
 */

import { getSupabase, isSupabaseConfigured } from "../supabase.js";
import { getOrCreateUser } from "../billing.js";
import { DEFAULT_RELAY_BILLING, type RelayBillingConfig } from "./types.js";

/**
 * Get relay billing config from environment (with defaults)
 */
export function getRelayBillingConfig(): RelayBillingConfig {
  return {
    commandCost: Number(process.env.RELAY_COMMAND_COST ?? DEFAULT_RELAY_BILLING.commandCost),
    resultCost: Number(process.env.RELAY_RESULT_COST ?? DEFAULT_RELAY_BILLING.resultCost),
    freeCommandsPerDay: Number(process.env.RELAY_FREE_COMMANDS ?? DEFAULT_RELAY_BILLING.freeCommandsPerDay),
    maxPendingCommands: Number(process.env.RELAY_MAX_PENDING ?? DEFAULT_RELAY_BILLING.maxPendingCommands),
    maxDevicesPerUser: Number(process.env.RELAY_MAX_DEVICES ?? DEFAULT_RELAY_BILLING.maxDevicesPerUser),
  };
}

/**
 * Check if user can send a relay command and charge credits.
 * Returns the cost charged (0 if free command available).
 */
export async function chargeRelayCommand(userId: string): Promise<{
  success: boolean;
  creditsCharged: number;
  remainingCredits: number;
  error?: string;
}> {
  const config = getRelayBillingConfig();

  if (!isSupabaseConfigured()) {
    return { success: true, creditsCharged: 0, remainingCredits: 1000 };
  }

  const supabase = getSupabase();

  // Check pending command limit
  const { count: pendingCount } = await supabase
    .from("relay_commands")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");

  if ((pendingCount ?? 0) >= config.maxPendingCommands) {
    return {
      success: false,
      creditsCharged: 0,
      remainingCredits: 0,
      error: `대기 중인 명령이 너무 많습니다 (최대 ${config.maxPendingCommands}개). 기존 명령이 완료될 때까지 기다려주세요.`,
    };
  }

  // Check free commands for today
  if (config.freeCommandsPerDay > 0) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: todayCount } = await supabase
      .from("relay_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "command")
      .gte("created_at", todayStart.toISOString());

    if ((todayCount ?? 0) < config.freeCommandsPerDay) {
      return { success: true, creditsCharged: 0, remainingCredits: 0 };
    }
  }

  // Charge credits using atomic deduction
  const cost = config.commandCost;

  // Get user to check balance first (avoid unnecessary RPC call)
  const user = await getOrCreateUser(userId);
  if (user.credits < cost) {
    return {
      success: false,
      creditsCharged: 0,
      remainingCredits: user.credits,
      error: `크레딧이 부족합니다. 원격 명령 비용: ${cost} 크레딧, 보유: ${user.credits} 크레딧`,
    };
  }

  // Use the existing deduct_credits RPC for atomic deduction
  // Note: We use the hashed user ID here since billing.ts hashes it
  const { hashUserId } = await import("../billing.js");
  const hashedId = hashUserId(userId);

  const { data, error } = await supabase.rpc("deduct_credits", {
    p_kakao_user_id: hashedId,
    p_amount: cost,
  });

  if (error) {
    return {
      success: false,
      creditsCharged: 0,
      remainingCredits: user.credits,
      error: `결제 처리 실패: ${error.message}`,
    };
  }

  const result = data?.[0];
  if (!result?.success) {
    return {
      success: false,
      creditsCharged: 0,
      remainingCredits: result?.new_balance ?? user.credits,
      error: result?.error_message ?? "크레딧 차감 실패",
    };
  }

  return {
    success: true,
    creditsCharged: cost,
    remainingCredits: result.new_balance,
  };
}

/**
 * Get relay usage stats for a user
 */
export async function getRelayUsageStats(userId: string): Promise<{
  totalCommands: number;
  totalCreditsUsed: number;
  commandsToday: number;
}> {
  if (!isSupabaseConfigured()) {
    return { totalCommands: 0, totalCreditsUsed: 0, commandsToday: 0 };
  }

  const supabase = getSupabase();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [totalResult, todayResult] = await Promise.all([
    supabase
      .from("relay_usage")
      .select("credits_used")
      .eq("user_id", userId)
      .eq("action", "command"),
    supabase
      .from("relay_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "command")
      .gte("created_at", todayStart.toISOString()),
  ]);

  const usageData = totalResult.data ?? [];
  const totalCreditsUsed = usageData.reduce((sum, row) => sum + (row.credits_used ?? 0), 0);

  return {
    totalCommands: usageData.length,
    totalCreditsUsed,
    commandsToday: todayResult.count ?? 0,
  };
}
