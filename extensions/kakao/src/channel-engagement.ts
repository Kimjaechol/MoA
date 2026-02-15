/**
 * Channel Engagement Module
 *
 * Handles:
 * 1. Channel subscription check + AlimTalk for non-members
 * 2. Daily morning weather greeting (cron-based)
 * 3. Viral sharing / referral mechanism
 * 4. Device control redirection to MoA app
 *
 * Flow for new website signups:
 *   User signs up on website → phone number collected →
 *   check if channel friend → if not, send AlimTalk with channel link →
 *   user joins channel → daily engagement begins
 */

import type { ResolvedKakaoAccount } from "./types.js";
import { createNotificationService, type NotificationService } from "./notification-service.js";
import { createKakaoApiClient } from "./api-client.js";
import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import { routeMessageFreeOnly, hasConnectedDevices, isFcmConfigured } from "./push/index.js";

// ============================================
// 1. Channel Subscription Check + AlimTalk
// ============================================

/** AlimTalk template for channel join invitation */
const CHANNEL_JOIN_TEMPLATE_CODE = "moa_channel_join";

/**
 * Check if a user is already a KakaoTalk channel friend,
 * and send an AlimTalk invitation if not.
 *
 * Called when a user signs up through the MoA website (not KakaoTalk).
 *
 * Note: Checking channel friend status requires the user to have authorized
 * the app via Kakao Login. For users who only provided a phone number,
 * we always send the AlimTalk invitation (it won't cause issues if they're
 * already a friend — they'll just see a friendly welcome).
 */
export async function inviteToChannelIfNeeded(params: {
  phoneNumber: string;
  username: string;
  userId: string;
  account: ResolvedKakaoAccount;
  /** If true, skip the channel friend check and always send */
  forceInvite?: boolean;
}): Promise<{
  sent: boolean;
  method: "alimtalk" | "friendtalk" | "skipped" | "error";
  reason?: string;
}> {
  const { phoneNumber, username, userId, account, forceInvite } = params;
  const notifier = createNotificationService(account);

  if (!notifier.isConfigured()) {
    return { sent: false, method: "error", reason: "Notification service not configured" };
  }

  // Check if user is already marked as channel friend in our DB
  if (!forceInvite && isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("lawcall_users")
      .select("is_channel_friend, kakao_user_id")
      .eq("id", userId)
      .single();

    if (data?.is_channel_friend || data?.kakao_user_id) {
      // User is already a channel friend or has interacted via KakaoTalk
      return { sent: false, method: "skipped", reason: "Already a channel friend" };
    }
  }

  // Send AlimTalk invitation to join the channel
  const result = await notifier.sendAlimTalk(phoneNumber, CHANNEL_JOIN_TEMPLATE_CODE, {
    username,
    channelName: "MoA AI 어시스턴트",
  });

  if (result.success) {
    // Mark that we sent an invitation
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      await supabase
        .from("lawcall_users")
        .update({
          channel_invite_sent_at: new Date().toISOString(),
        })
        .eq("id", userId);
    }

    console.log(`[engagement] Channel join AlimTalk sent to ${phoneNumber.slice(0, 7)}***`);
    return { sent: true, method: result.method === "alimtalk" ? "alimtalk" : "friendtalk" };
  }

  return { sent: false, method: "error", reason: result.error };
}

/**
 * Mark a user as a channel friend when they first interact via KakaoTalk.
 * Called from the webhook handler when we receive the first message.
 */
export async function markAsChannelFriend(kakaoUserId: string): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const supabase = getSupabase();
  const { data } = await supabase
    .from("lawcall_users")
    .select("id, is_channel_friend")
    .eq("kakao_user_id", kakaoUserId)
    .single();

  if (data && !data.is_channel_friend) {
    await supabase
      .from("lawcall_users")
      .update({ is_channel_friend: true })
      .eq("id", data.id);
  }
}

// ============================================
// 2. Daily Morning Weather Greeting
// ============================================

/** Weather greeting interval check — ensures we don't send more than once per day */
const lastWeatherSent = new Map<string, number>();

/**
 * Send daily morning weather greeting to all channel friends.
 *
 * This is designed to be called from a cron job or scheduler.
 * It fetches weather for Seoul and sends a friendly morning message.
 *
 * Implementation note:
 * - Uses FriendTalk (not AlimTalk) for the flexible message format
 * - Only sends to users who have registered phone numbers
 * - Respects user opt-out preferences
 */
export async function sendDailyWeatherGreeting(account: ResolvedKakaoAccount): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const notifier = createNotificationService(account);
  if (!notifier.isConfigured() || !isSupabaseConfigured()) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  // Fetch weather data
  const weather = await fetchWeatherData();
  if (!weather) {
    console.warn("[engagement] Failed to fetch weather data — skipping daily greeting");
    return { sent: 0, failed: 0, skipped: 0 };
  }

  // Build greeting message
  const now = new Date();
  const timeStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${getDayOfWeek(now)}`;
  const greetingMessage = buildWeatherGreeting(timeStr, weather);

  // Get all users with phone numbers who opted in for notifications
  const supabase = getSupabase();
  const { data: users } = await supabase
    .from("lawcall_users")
    .select("id, phone_number, weather_opt_out")
    .not("phone_number", "is", null)
    .eq("is_channel_friend", true);

  if (!users || users.length === 0) {
    return { sent: 0, failed: 0, skipped: 0 };
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const user of users) {
    // Skip opted-out users
    if (user.weather_opt_out) {
      skipped++;
      continue;
    }

    // Skip if already sent today
    const lastSent = lastWeatherSent.get(user.id);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (lastSent && lastSent > todayStart.getTime()) {
      skipped++;
      continue;
    }

    // 무료 우선 발송: Gateway/FCM 먼저, 실패 시에만 FriendTalk
    let delivered = false;

    if (hasConnectedDevices(user.id) || isFcmConfigured()) {
      const freeResult = await routeMessageFreeOnly(user.id, {
        title: "좋은 아침이에요!",
        body: greetingMessage,
        data: { type: "daily_weather" },
      });
      if (freeResult.success) {
        delivered = true;
      }
    }

    // 무료 채널 실패 시 FriendTalk 폴백
    if (!delivered && user.phone_number) {
      const result = await notifier.sendFriendTalk(user.phone_number, greetingMessage);
      delivered = result.success;
    }

    if (delivered) {
      sent++;
      lastWeatherSent.set(user.id, Date.now());
    } else {
      failed++;
    }

    // Rate limiting: small delay between sends
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`[engagement] Daily weather: sent=${sent}, failed=${failed}, skipped=${skipped}`);
  return { sent, failed, skipped };
}

/**
 * Fetch weather data from a public API
 * Uses the wttr.in service which doesn't require API keys
 */
async function fetchWeatherData(): Promise<WeatherData | null> {
  try {
    const response = await fetch("https://wttr.in/Seoul?format=j1", {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as WttrResponse;
    const current = data.current_condition?.[0];
    const forecast = data.weather?.[0];

    if (!current) return null;

    return {
      temp: current.temp_C,
      feelsLike: current.FeelsLikeC,
      humidity: current.humidity,
      description: getKoreanWeatherDescription(current.weatherCode),
      maxTemp: forecast?.maxtempC ?? current.temp_C,
      minTemp: forecast?.mintempC ?? current.temp_C,
      precipMm: forecast?.totalSnow_cm ? `눈 ${forecast.totalSnow_cm}cm` : undefined,
      uvIndex: forecast?.uvIndex,
    };
  } catch (err) {
    console.warn("[engagement] Weather fetch failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

interface WeatherData {
  temp: string;
  feelsLike: string;
  humidity: string;
  description: string;
  maxTemp: string;
  minTemp: string;
  precipMm?: string;
  uvIndex?: string;
}

interface WttrResponse {
  current_condition?: Array<{
    temp_C: string;
    FeelsLikeC: string;
    humidity: string;
    weatherCode: string;
  }>;
  weather?: Array<{
    maxtempC: string;
    mintempC: string;
    totalSnow_cm?: string;
    uvIndex?: string;
  }>;
}

function getKoreanWeatherDescription(code: string): string {
  const codeNum = parseInt(code, 10);
  if (codeNum <= 113) return "맑음";
  if (codeNum <= 122) return "구름 조금";
  if (codeNum <= 143) return "흐림";
  if (codeNum <= 182) return "안개";
  if (codeNum <= 200) return "비 가능성";
  if (codeNum <= 232) return "눈 가능성";
  if (codeNum <= 302) return "이슬비";
  if (codeNum <= 395) return "비 또는 눈";
  return "다양한 날씨";
}

function getDayOfWeek(date: Date): string {
  const days = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return days[date.getDay()];
}

function buildWeatherGreeting(dateStr: string, weather: WeatherData): string {
  const tempAdvice = parseInt(weather.temp, 10) < 5
    ? "오늘은 많이 춥습니다. 따뜻하게 입고 나가세요!"
    : parseInt(weather.temp, 10) < 15
      ? "쌀쌀한 날씨입니다. 겉옷을 챙기세요."
      : parseInt(weather.temp, 10) < 25
        ? "활동하기 좋은 날씨입니다!"
        : "더운 날씨입니다. 수분 보충을 잊지 마세요!";

  return `좋은 아침이에요! ${dateStr}

오늘의 서울 날씨: ${weather.description}
현재 ${weather.temp}°C (체감 ${weather.feelsLike}°C)
최저 ${weather.minTemp}°C / 최고 ${weather.maxTemp}°C
습도 ${weather.humidity}%
${weather.precipMm ? `\n${weather.precipMm}` : ""}
${tempAdvice}

오늘도 MoA와 함께 좋은 하루 보내세요!
궁금한 것이 있으면 언제든 말씀해주세요.`;
}

/**
 * Start the daily weather greeting scheduler.
 * Sends at 7:30 AM KST every day.
 */
export function startWeatherScheduler(account: ResolvedKakaoAccount): {
  stop: () => void;
} {
  const TARGET_HOUR_KST = 7;
  const TARGET_MINUTE = 30;

  let timer: ReturnType<typeof setInterval> | null = null;

  // Check every minute if it's time to send
  timer = setInterval(async () => {
    const now = new Date();
    // Convert to KST (UTC+9)
    const kstHour = (now.getUTCHours() + 9) % 24;
    const kstMinute = now.getUTCMinutes();

    if (kstHour === TARGET_HOUR_KST && kstMinute === TARGET_MINUTE) {
      console.log("[engagement] Daily weather greeting time — sending...");
      await sendDailyWeatherGreeting(account);
    }
  }, 60_000); // Check every minute

  console.log(`[engagement] Weather scheduler started (daily at ${TARGET_HOUR_KST}:${String(TARGET_MINUTE).padStart(2, "0")} KST)`);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

// ============================================
// 3. Viral Sharing / Referral Mechanism
// ============================================

/**
 * Generate a shareable referral link for KakaoTalk sharing.
 *
 * The referral link includes the user's referral code for tracking.
 * When shared via KakaoTalk, it opens a card-style share dialog.
 */
export function generateShareContent(params: {
  referrerName?: string;
  referralCode: string;
}): {
  text: string;
  quickReplies: string[];
  shareUrl: string;
  shareMessage: string;
} {
  const shareUrl = `https://mymoa.app/invite/${params.referralCode}`;

  const shareMessage = params.referrerName
    ? `${params.referrerName}님이 MoA를 추천했습니다!\n\n카카오톡으로 내 컴퓨터를 원격 제어하고, AI 어시스턴트와 대화해보세요.\n\n${shareUrl}`
    : `MoA - 카카오톡으로 내 컴퓨터를 원격 제어하는 AI 어시스턴트\n\n${shareUrl}`;

  return {
    text: `친구에게 MoA를 공유해보세요!

아래 메시지를 복사해서 카카오톡 대화방에 붙여넣으세요:

━━━━━━━━━━━━━━━━━━━━━━
${shareMessage}
━━━━━━━━━━━━━━━━━━━━━━

또는 아래 링크를 직접 공유하세요:
${shareUrl}

친구가 위 링크로 가입하면 함께 보너스 크레딧을 받으실 수 있습니다!`,
    quickReplies: ["도움말", "기기"],
    shareUrl,
    shareMessage,
  };
}

/**
 * Generate or retrieve a user's referral code
 */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  if (!isSupabaseConfigured()) {
    // Generate a simple code without DB
    return `moa-${userId.slice(0, 8)}`;
  }

  const supabase = getSupabase();
  const { data } = await supabase
    .from("lawcall_users")
    .select("referral_code")
    .eq("id", userId)
    .single();

  if (data?.referral_code) {
    return data.referral_code;
  }

  // Generate a new referral code
  const code = `moa-${generateShortId()}`;

  await supabase
    .from("lawcall_users")
    .update({ referral_code: code })
    .eq("id", userId);

  return code;
}

/**
 * Process a referral when a new user signs up with a referral code
 */
export async function processReferral(
  referralCode: string,
  newUserId: string,
): Promise<{
  success: boolean;
  referrerName?: string;
  bonusCredits?: number;
}> {
  if (!isSupabaseConfigured()) {
    return { success: false };
  }

  const supabase = getSupabase();

  // Find referrer
  const { data: referrer } = await supabase
    .from("lawcall_users")
    .select("id, kakao_user_id")
    .eq("referral_code", referralCode)
    .single();

  if (!referrer) {
    return { success: false };
  }

  // Don't allow self-referral
  if (referrer.id === newUserId) {
    return { success: false };
  }

  const bonusCredits = 500; // Bonus for both referrer and new user

  // Grant bonus credits to both
  await supabase.rpc("add_credits", { user_id: referrer.id, amount: bonusCredits });
  await supabase.rpc("add_credits", { user_id: newUserId, amount: bonusCredits });

  // Record the referral
  await supabase.from("referrals").insert({
    referrer_id: referrer.id,
    referred_id: newUserId,
    referral_code: referralCode,
    bonus_credits: bonusCredits,
  });

  return {
    success: true,
    bonusCredits,
  };
}

function generateShortId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ============================================
// 4. Device Control Redirection
// ============================================

/**
 * Check if a message is a device control command and the user
 * should be redirected to use the MoA app instead of KakaoTalk.
 *
 * Returns a redirection message if the command is critical and
 * should only be executed from the app, or null if it's OK in chat.
 */
export function checkDeviceControlRedirection(
  utterance: string,
  isAuthenticated: boolean,
): { shouldRedirect: boolean; message?: string } {
  // Only applies to device commands (@device commands)
  if (!utterance.startsWith("@")) {
    return { shouldRedirect: false };
  }

  // Authenticated users can use device commands in KakaoTalk
  // (with passphrase verification which is already handled in server.ts)
  if (isAuthenticated) {
    return { shouldRedirect: false };
  }

  // Critical commands that should redirect to app
  const criticalPatterns = [
    /^@\S+\s+(rm|delete|remove|삭제|제거)/i,
    /^@\S+\s+(sudo|chmod|chown)/i,
    /^@\S+\s+(kill|pkill|shutdown|reboot|종료|재부팅)/i,
    /^@\S+\s+(curl|wget|ssh|scp).*password/i,
    /^@\S+\s+(git\s+push.*--force|git\s+reset\s+--hard)/i,
    /^@\S+\s+.*[|&;].*rm/i,
  ];

  const isCritical = criticalPatterns.some((p) => p.test(utterance));

  if (isCritical) {
    return {
      shouldRedirect: true,
      message: `이 명령은 보안상 MoA 앱에서 실행해야 합니다.

카카오톡에서 기기를 제어하려면:
1. "사용자 인증" 을 입력하여 먼저 로그인해주세요
2. 인증 후 구문번호를 설정하면 기기 제어가 가능합니다

또는 MoA 앱에서 직접 실행하세요:
https://mymoa.app

MoA 앱에서는 더 안전하고 상세한 기기 제어가 가능합니다.`,
    };
  }

  // Non-critical device commands: still require authentication
  return {
    shouldRedirect: true,
    message: `기기 제어 기능을 사용하려면 먼저 인증이 필요합니다.

"사용자 인증" 을 입력하여 로그인해주세요.
아직 MoA 계정이 없으시다면 "설치"를 입력하여 먼저 가입해주세요.

MoA 앱에서 로그인하면 더 편리하게 사용할 수 있습니다!`,
  };
}
