import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  sendAlimtalkWithLog,
  hasAlreadySent,
  normalizePhone,
  isValidKoreanMobile,
} from "@/lib/alimtalk";
import { CHANNEL_INVITE_TEMPLATE } from "@/lib/alimtalk-templates";

/**
 * POST /api/alimtalk
 *
 * Actions:
 *   - send_channel_invite: 카카오톡 채널 추가 유도 알림톡 발송
 *   - mark_channel_added: 채널 추가 완료 표시
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, user_id } = body;

    if (!user_id || typeof user_id !== "string") {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    switch (action) {
      case "send_channel_invite": {
        // 사용자 설정에서 전화번호 조회
        const { data: settings } = await supabase
          .from("moa_user_settings")
          .select("phone, kakao_channel_added")
          .eq("user_id", user_id)
          .single();

        if (!settings?.phone) {
          return NextResponse.json(
            { error: "전화번호가 등록되어 있지 않습니다." },
            { status: 400 },
          );
        }

        // 이미 채널 추가한 경우 스킵
        if (settings.kakao_channel_added) {
          return NextResponse.json({
            success: true,
            skipped: true,
            reason: "이미 카카오톡 채널을 추가하셨습니다.",
          });
        }

        // 이미 발송한 경우 중복 방지
        const alreadySent = await hasAlreadySent({
          userId: user_id,
          templateCode: CHANNEL_INVITE_TEMPLATE.code,
        });

        if (alreadySent) {
          return NextResponse.json({
            success: true,
            skipped: true,
            reason: "이미 채널 추가 안내 알림톡이 발송되었습니다.",
          });
        }

        const phone = normalizePhone(settings.phone);
        const nickname = body.nickname || "회원";

        const result = await sendAlimtalkWithLog({
          userId: user_id,
          recipientNo: phone,
          templateCode: CHANNEL_INVITE_TEMPLATE.code,
          templateParameter: { nickname },
        });

        if (result.success) {
          return NextResponse.json({
            success: true,
            requestId: result.requestId,
            message: "카카오톡 채널 추가 안내 알림톡이 발송되었습니다.",
          });
        }

        return NextResponse.json(
          { success: false, error: result.error },
          { status: 502 },
        );
      }

      case "mark_channel_added": {
        const { error } = await supabase
          .from("moa_user_settings")
          .update({
            kakao_channel_added: true,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", user_id);

        if (error) {
          return NextResponse.json(
            { error: "채널 상태 업데이트 실패" },
            { status: 500 },
          );
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/alimtalk?user_id=xxx
 *
 * 사용자의 알림톡 발송 상태 조회
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    const { data: settings } = await supabase
      .from("moa_user_settings")
      .select("phone, phone_verified, kakao_channel_added")
      .eq("user_id", userId)
      .single();

    const { data: logs } = await supabase
      .from("moa_alimtalk_log")
      .select("template_code, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    const channelInviteSent = logs?.some(
      (log) =>
        log.template_code === CHANNEL_INVITE_TEMPLATE.code &&
        log.status === "sent",
    ) ?? false;

    return NextResponse.json({
      phone: settings?.phone
        ? maskPhone(settings.phone)
        : null,
      phoneVerified: settings?.phone_verified ?? false,
      kakaoChannelAdded: settings?.kakao_channel_added ?? false,
      channelInviteSent,
      recentLogs: logs ?? [],
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** 전화번호 마스킹: 010-1234-5678 → 010-****-5678 */
function maskPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.length < 7) return "***";
  return (
    normalized.slice(0, 3) +
    "-****-" +
    normalized.slice(-4)
  );
}
