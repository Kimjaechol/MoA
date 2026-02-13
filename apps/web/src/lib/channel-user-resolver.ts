/**
 * Cross-Channel User Resolver
 *
 * Unifies user identity across all messaging channels (Telegram, Discord,
 * KakaoTalk, Web, etc.) so that:
 *
 * 1. A single user gets ONE identity regardless of which channel they use
 * 2. Settings, API keys, credits, and LLM model preferences are shared
 * 3. Conversation history is per-channel but credits/settings are unified
 * 4. Long-term memory can be shared across channels (opt-in)
 *
 * Architecture:
 *
 *   User signs up on mymoa.app → gets `moa_user_id` (e.g., "user_abc123")
 *   User connects Telegram   → moa_channel_connections: tg_777 → user_abc123
 *   User connects Discord    → moa_channel_connections: discord_888 → user_abc123
 *   User connects KakaoTalk  → moa_channel_connections: kakao_999 → user_abc123
 *
 *   When a message arrives from Telegram user 777:
 *     1. Look up moa_channel_connections for channel=telegram, channel_user_id=777
 *     2. If found → use linked moa_user_id (user_abc123)
 *     3. If not found → use channel-scoped ID (tg_777) as temporary identity
 *
 *   Benefits:
 *     - tg_777 and discord_888 share the same API keys, credits, model settings
 *     - Each channel still has its own session_id for conversation isolation
 *     - User can link/unlink channels from web dashboard
 *
 * DB Table: moa_channel_connections
 *   - user_id        (MoA user ID — FK to moa_users)
 *   - channel        (telegram, discord, kakao, web, etc.)
 *   - channel_user_id (platform-specific user ID)
 *   - display_name   (user's display name on that channel)
 *   - is_active      (whether connection is active)
 *   - linked_at      (when linked)
 *   - last_message_at (last activity)
 */

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

export type ChannelType =
  | "telegram"
  | "discord"
  | "kakao"
  | "web"
  | "whatsapp"
  | "line"
  | "slack"
  | "signal"
  | "imessage"
  | "msteams"
  | "googlechat"
  | "matrix"
  | "mattermost"
  | "nextcloud-talk"
  | "twitch"
  | "nostr"
  | "zalo"
  | "bluebubbles"
  | "tlon";

export interface ChannelIdentity {
  /** The channel platform */
  channel: ChannelType;
  /** The user's ID on the channel platform */
  channelUserId: string;
  /** The user's display name on the channel */
  displayName?: string;
}

export interface ResolvedUser {
  /** The unified MoA user ID (from moa_users) */
  moaUserId: string;
  /** Whether the user is linked to a MoA account */
  isLinked: boolean;
  /** The channel-scoped fallback ID (e.g., tg_123) */
  channelScopedId: string;
  /** User's display name */
  displayName?: string;
  /** The effective user ID to use for all operations */
  effectiveUserId: string;
}

export interface UserSettings {
  /** Model strategy: cost-efficient, max-performance, or manual */
  modelStrategy: string;
  /** Preferred provider (if manual) */
  preferredProvider?: string;
  /** Preferred model (if manual) */
  preferredModel?: string;
  /** Whether user has their own API keys */
  hasOwnApiKeys: boolean;
  /** Active API key providers */
  activeProviders: string[];
}

export interface UnifiedUserContext {
  /** Resolved user identity */
  user: ResolvedUser;
  /** User's LLM settings (shared across channels) */
  settings: UserSettings;
  /** User's credit balance */
  credits: { balance: number; plan: string; monthlyUsed: number; monthlyQuota: number };
  /** Session ID for this channel conversation (isolated per channel) */
  sessionId: string;
}

// ────────────────────────────────────────────
// Channel-scoped ID generation
// ────────────────────────────────────────────

/** Generate a channel-scoped user ID for unlinked users */
export function makeChannelScopedId(channel: ChannelType, channelUserId: string): string {
  const prefixMap: Record<ChannelType, string> = {
    telegram: "tg",
    discord: "discord",
    kakao: "kakao",
    web: "web",
    whatsapp: "wa",
    line: "line",
    slack: "slack",
    signal: "signal",
    imessage: "imsg",
    msteams: "teams",
    googlechat: "gchat",
    matrix: "matrix",
    mattermost: "mm",
    "nextcloud-talk": "nc",
    twitch: "twitch",
    nostr: "nostr",
    zalo: "zalo",
    bluebubbles: "bb",
    tlon: "tlon",
  };
  return `${prefixMap[channel]}_${channelUserId}`;
}

/** Generate session ID for a channel conversation */
export function makeSessionId(channel: ChannelType, channelUserId: string): string {
  return `${channel}_${channelUserId}`;
}

// ────────────────────────────────────────────
// Core Resolution Logic
// ────────────────────────────────────────────

/**
 * Resolve a channel user to a unified MoA identity.
 *
 * Steps:
 * 1. Look up moa_channel_connections for existing link
 * 2. If linked → return moa_user_id
 * 3. If not linked → return channel-scoped ID as fallback
 * 4. Upsert connection record for tracking
 */
export async function resolveChannelUser(identity: ChannelIdentity): Promise<ResolvedUser> {
  const channelScopedId = makeChannelScopedId(identity.channel, identity.channelUserId);

  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();

    // Look up existing channel connection
    const { data: connection } = await supabase
      .from("moa_channel_connections")
      .select("user_id, display_name, is_active")
      .eq("channel", identity.channel)
      .eq("channel_user_id", identity.channelUserId)
      .eq("is_active", true)
      .single();

    if (connection?.user_id) {
      // User is linked to a MoA account
      return {
        moaUserId: connection.user_id,
        isLinked: true,
        channelScopedId,
        displayName: identity.displayName ?? connection.display_name,
        effectiveUserId: connection.user_id,
      };
    }

    // Also check if this channel-scoped ID was already used as a user_id
    // (backwards compatibility: early users before linking existed)
    const { data: legacyUser } = await supabase
      .from("moa_credits")
      .select("user_id")
      .eq("user_id", channelScopedId)
      .single();

    // Upsert channel connection (best-effort, for tracking)
    await supabase.from("moa_channel_connections").upsert({
      user_id: legacyUser?.user_id ?? channelScopedId,
      channel: identity.channel,
      channel_user_id: identity.channelUserId,
      display_name: identity.displayName ?? `${identity.channel} user`,
      is_active: true,
      last_message_at: new Date().toISOString(),
    }, { onConflict: "channel,channel_user_id" });

    return {
      moaUserId: legacyUser?.user_id ?? channelScopedId,
      isLinked: false,
      channelScopedId,
      displayName: identity.displayName,
      effectiveUserId: legacyUser?.user_id ?? channelScopedId,
    };
  } catch {
    // Supabase unavailable — fall back to channel-scoped ID
    return {
      moaUserId: channelScopedId,
      isLinked: false,
      channelScopedId,
      displayName: identity.displayName,
      effectiveUserId: channelScopedId,
    };
  }
}

// ────────────────────────────────────────────
// Unified Settings & Credits Lookup
// ────────────────────────────────────────────

/**
 * Get user's LLM settings (model strategy, API keys, etc.).
 * Uses the effective user ID (unified across channels).
 */
export async function getUserLLMSettings(effectiveUserId: string): Promise<UserSettings> {
  const defaults: UserSettings = {
    modelStrategy: "cost-efficient",
    hasOwnApiKeys: false,
    activeProviders: [],
  };

  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();

    // Fetch settings
    const { data: settings } = await supabase
      .from("moa_user_settings")
      .select("model_strategy, preferred_provider, preferred_model")
      .eq("user_id", effectiveUserId)
      .single();

    // Fetch active API keys
    const { data: keys } = await supabase
      .from("moa_user_api_keys")
      .select("provider")
      .eq("user_id", effectiveUserId)
      .eq("is_active", true);

    const activeProviders = (keys ?? []).map((k: { provider: string }) => k.provider);

    return {
      modelStrategy: settings?.model_strategy ?? "cost-efficient",
      preferredProvider: settings?.preferred_provider,
      preferredModel: settings?.preferred_model,
      hasOwnApiKeys: activeProviders.length > 0,
      activeProviders,
    };
  } catch {
    return defaults;
  }
}

/**
 * Get user's credit balance.
 * Uses the effective user ID (unified across channels).
 */
export async function getUserCredits(effectiveUserId: string): Promise<{
  balance: number;
  plan: string;
  monthlyUsed: number;
  monthlyQuota: number;
}> {
  const defaults = { balance: 100, plan: "free", monthlyUsed: 0, monthlyQuota: 100 };

  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();

    const { data } = await supabase
      .from("moa_credits")
      .select("balance, plan, monthly_used, monthly_quota")
      .eq("user_id", effectiveUserId)
      .single();

    if (data) {
      return {
        balance: data.balance,
        plan: data.plan,
        monthlyUsed: data.monthly_used ?? 0,
        monthlyQuota: data.monthly_quota ?? 100,
      };
    }
  } catch { /* DB not available */ }

  return defaults;
}

// ────────────────────────────────────────────
// Full Context Resolution (All-in-One)
// ────────────────────────────────────────────

/**
 * Resolve a complete user context for any channel message.
 *
 * This is the main entry point — call this from webhook handlers.
 * Returns everything needed: user identity, settings, credits, session.
 */
export async function resolveFullUserContext(identity: ChannelIdentity): Promise<UnifiedUserContext> {
  const user = await resolveChannelUser(identity);

  const [settings, credits] = await Promise.all([
    getUserLLMSettings(user.effectiveUserId),
    getUserCredits(user.effectiveUserId),
  ]);

  return {
    user,
    settings,
    credits,
    sessionId: makeSessionId(identity.channel, identity.channelUserId),
  };
}

// ────────────────────────────────────────────
// Channel Linking/Unlinking (for web dashboard)
// ────────────────────────────────────────────

/**
 * Link a channel account to a MoA user.
 * Called from web dashboard when user connects a channel.
 */
export async function linkChannelAccount(params: {
  moaUserId: string;
  channel: ChannelType;
  channelUserId: string;
  displayName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();

    // Check if this channel account is already linked to another user
    const { data: existing } = await supabase
      .from("moa_channel_connections")
      .select("user_id")
      .eq("channel", params.channel)
      .eq("channel_user_id", params.channelUserId)
      .eq("is_active", true)
      .single();

    if (existing && existing.user_id !== params.moaUserId) {
      return { success: false, error: "이 채널 계정은 이미 다른 사용자에게 연결되어 있습니다." };
    }

    // Migrate existing data from channel-scoped ID to MoA user ID
    const channelScopedId = makeChannelScopedId(params.channel as ChannelType, params.channelUserId);
    if (channelScopedId !== params.moaUserId) {
      await migrateUserData(supabase, channelScopedId, params.moaUserId);
    }

    // Upsert the connection
    await supabase.from("moa_channel_connections").upsert({
      user_id: params.moaUserId,
      channel: params.channel,
      channel_user_id: params.channelUserId,
      display_name: params.displayName ?? `${params.channel} user`,
      is_active: true,
      linked_at: new Date().toISOString(),
    }, { onConflict: "channel,channel_user_id" });

    return { success: true };
  } catch (err) {
    console.error("[channel-link] Error:", err);
    return { success: false, error: "연결 중 오류가 발생했습니다." };
  }
}

/**
 * Unlink a channel account from a MoA user.
 */
export async function unlinkChannelAccount(params: {
  moaUserId: string;
  channel: ChannelType;
  channelUserId: string;
}): Promise<{ success: boolean }> {
  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();

    await supabase
      .from("moa_channel_connections")
      .update({ is_active: false })
      .eq("user_id", params.moaUserId)
      .eq("channel", params.channel)
      .eq("channel_user_id", params.channelUserId);

    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Get all linked channels for a MoA user.
 */
export async function getLinkedChannels(moaUserId: string): Promise<Array<{
  channel: ChannelType;
  channelUserId: string;
  displayName: string;
  lastMessageAt: string | null;
}>> {
  try {
    const { getServiceSupabase } = await import("@/lib/supabase");
    const supabase = getServiceSupabase();

    const { data } = await supabase
      .from("moa_channel_connections")
      .select("channel, channel_user_id, display_name, last_message_at")
      .eq("user_id", moaUserId)
      .eq("is_active", true)
      .order("last_message_at", { ascending: false });

    return (data ?? []).map((d: { channel: string; channel_user_id: string; display_name: string; last_message_at: string | null }) => ({
      channel: d.channel as ChannelType,
      channelUserId: d.channel_user_id,
      displayName: d.display_name,
      lastMessageAt: d.last_message_at,
    }));
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────
// Data Migration (when linking accounts)
// ────────────────────────────────────────────

/**
 * Migrate user data from a channel-scoped ID to a unified MoA user ID.
 * Transfers credits, chat history, and settings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function migrateUserData(supabase: any, fromUserId: string, toUserId: string): Promise<void> {
  // Migrate credits (add to existing balance)
  try {
    const { data: fromCredits } = await supabase
      .from("moa_credits")
      .select("balance")
      .eq("user_id", fromUserId)
      .single();

    if (fromCredits && fromCredits.balance > 0) {
      const { data: toCredits } = await supabase
        .from("moa_credits")
        .select("balance")
        .eq("user_id", toUserId)
        .single();

      if (toCredits) {
        // Add balance to existing
        await supabase
          .from("moa_credits")
          .update({ balance: toCredits.balance + fromCredits.balance })
          .eq("user_id", toUserId);
      } else {
        // Transfer entire record
        await supabase
          .from("moa_credits")
          .update({ user_id: toUserId })
          .eq("user_id", fromUserId);
      }
    }
  } catch { /* non-critical */ }

  // Migrate chat messages (update user_id)
  try {
    await supabase
      .from("moa_chat_messages")
      .update({ user_id: toUserId })
      .eq("user_id", fromUserId);
  } catch { /* non-critical */ }

  // Migrate API keys (update user_id)
  try {
    await supabase
      .from("moa_user_api_keys")
      .update({ user_id: toUserId })
      .eq("user_id", fromUserId);
  } catch { /* non-critical */ }

  // Migrate settings
  try {
    await supabase
      .from("moa_user_settings")
      .update({ user_id: toUserId })
      .eq("user_id", fromUserId);
  } catch { /* non-critical */ }
}
