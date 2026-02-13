import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  linkChannelAccount,
  unlinkChannelAccount,
  getLinkedChannels,
  type ChannelType,
} from "@/lib/channel-user-resolver";

const VALID_CHANNELS: ChannelType[] = [
  "telegram", "discord", "kakao", "web", "whatsapp", "line", "slack",
  "signal", "imessage", "msteams", "googlechat", "matrix", "mattermost",
  "nextcloud-talk", "twitch", "nostr", "zalo", "bluebubbles", "tlon",
];

/**
 * Validate session token and return user_id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authenticateRequest(supabase: any, token: string | undefined): Promise<{ user_id: string } | null> {
  if (!token || typeof token !== "string") return null;
  const { data, error } = await supabase
    .from("moa_sessions")
    .select("user_id, expires_at")
    .eq("token", token)
    .single();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  return { user_id: data.user_id };
}

/**
 * GET /api/channels/link?user_id=xxx&token=yyy
 * Get all linked channels for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const token = searchParams.get("token");

    if (!userId) {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const session = await authenticateRequest(supabase, token ?? undefined);
    if (!session || session.user_id !== userId) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    const channels = await getLinkedChannels(userId);

    return NextResponse.json({ channels });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/channels/link
 * Actions: link, unlink
 *
 * Link:   { action: "link",   user_id, token, channel, channel_user_id, display_name? }
 * Unlink: { action: "unlink", user_id, token, channel, channel_user_id }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, user_id, token, channel, channel_user_id, display_name } = body;

    if (!user_id || typeof user_id !== "string") {
      return NextResponse.json({ error: "user_id is required" }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const session = await authenticateRequest(supabase, token);
    if (!session || session.user_id !== user_id) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }

    if (!channel || !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json({ error: "유효한 채널을 선택해주세요." }, { status: 400 });
    }

    if (!channel_user_id || typeof channel_user_id !== "string") {
      return NextResponse.json({ error: "채널 사용자 ID가 필요합니다." }, { status: 400 });
    }

    switch (action) {
      case "link": {
        const result = await linkChannelAccount({
          moaUserId: user_id,
          channel: channel as ChannelType,
          channelUserId: channel_user_id.trim(),
          displayName: display_name?.trim(),
        });

        if (!result.success) {
          return NextResponse.json({ error: result.error }, { status: 409 });
        }

        return NextResponse.json({ success: true });
      }

      case "unlink": {
        const result = await unlinkChannelAccount({
          moaUserId: user_id,
          channel: channel as ChannelType,
          channelUserId: channel_user_id.trim(),
        });

        if (!result.success) {
          return NextResponse.json({ error: "연결 해제에 실패했습니다." }, { status: 500 });
        }

        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Invalid action. Use 'link' or 'unlink'." }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
