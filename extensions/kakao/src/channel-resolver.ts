/**
 * Channel User Resolver for KakaoTalk Extension
 *
 * Resolves KakaoTalk user IDs to unified MoA user identities by checking
 * `moa_channel_connections` first, then falling back to the legacy
 * `lawcall_users` table.
 *
 * This allows KakaoTalk users who link their account on mymoa.app to
 * share credits, API keys, and settings across all channels.
 */

import { getSupabase, isSupabaseConfigured } from "./supabase.js";

export interface ResolvedKakaoUser {
  /** The effective user ID to use for all operations */
  effectiveUserId: string;
  /** Whether the user has a linked MoA account */
  isLinked: boolean;
  /** The legacy lawcall_users.id (if exists) */
  legacyUserId?: string;
  /** Display name from the channel connection */
  displayName?: string;
}

/**
 * Resolve a KakaoTalk user to their unified MoA identity.
 *
 * Resolution order:
 * 1. Check `moa_channel_connections` for active link → use linked `user_id`
 * 2. Check `lawcall_users` for legacy mapping → use `lawcall_users.id`
 * 3. Fall back to channel-scoped ID: `kakao_{kakaoUserId}`
 *
 * Also upserts the connection record for tracking.
 */
export async function resolveKakaoUser(kakaoUserId: string): Promise<ResolvedKakaoUser> {
  const channelScopedId = `kakao_${kakaoUserId}`;

  if (!isSupabaseConfigured()) {
    return {
      effectiveUserId: channelScopedId,
      isLinked: false,
    };
  }

  try {
    const supabase = getSupabase();

    // 1. Check moa_channel_connections for linked account
    const { data: connection } = await supabase
      .from("moa_channel_connections")
      .select("user_id, display_name, is_active")
      .eq("channel", "kakao")
      .eq("channel_user_id", kakaoUserId)
      .eq("is_active", true)
      .single();

    if (connection?.user_id) {
      // Update last_message_at (best-effort)
      supabase
        .from("moa_channel_connections")
        .update({ last_message_at: new Date().toISOString() })
        .eq("channel", "kakao")
        .eq("channel_user_id", kakaoUserId)
        .then(() => {}, () => {});

      return {
        effectiveUserId: connection.user_id,
        isLinked: true,
        displayName: connection.display_name,
      };
    }

    // 2. Check lawcall_users for legacy mapping
    const { data: legacyUser } = await supabase
      .from("lawcall_users")
      .select("id")
      .eq("kakao_user_id", kakaoUserId)
      .single();

    const effectiveUserId = legacyUser?.id ?? channelScopedId;

    // 3. Upsert channel connection for tracking (best-effort)
    supabase
      .from("moa_channel_connections")
      .upsert(
        {
          user_id: effectiveUserId,
          channel: "kakao",
          channel_user_id: kakaoUserId,
          display_name: "KakaoTalk user",
          is_active: true,
          last_message_at: new Date().toISOString(),
        },
        { onConflict: "channel,channel_user_id" },
      )
      .then(() => {}, () => {});

    return {
      effectiveUserId,
      isLinked: false,
      legacyUserId: legacyUser?.id,
    };
  } catch {
    // Supabase unavailable — fall back to channel-scoped ID
    return {
      effectiveUserId: channelScopedId,
      isLinked: false,
    };
  }
}

/**
 * Get or create a lawcall_users entry for a KakaoTalk user.
 * This preserves backward compatibility with existing relay, billing,
 * and sync features that depend on lawcall_users.id.
 */
export async function getOrCreateLegacyUser(kakaoUserId: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const supabase = getSupabase();

    const { data: existing } = await supabase
      .from("lawcall_users")
      .select("id")
      .eq("kakao_user_id", kakaoUserId)
      .single();

    if (existing) return existing.id;

    const { data: newUser } = await supabase
      .from("lawcall_users")
      .insert({ kakao_user_id: kakaoUserId })
      .select("id")
      .single();

    return newUser?.id ?? null;
  } catch {
    return null;
  }
}
