/**
 * Channel Allowlist
 *
 * Controls which users/groups can access the gateway per channel.
 * Benchmarked from OpenClaw's channel allowlist + RBAC scopes.
 *
 * Modes:
 *   - "open": anyone can use the channel (default for development)
 *   - "allowlist": only listed users/groups can use the channel
 *   - "disabled": channel is completely disabled
 */

import { logger } from "../logger.js";

export type AllowlistMode = "open" | "allowlist" | "disabled";

interface ChannelAllowlist {
  mode: AllowlistMode;
  /** Allowed user IDs (channel-specific format) */
  users: Set<string>;
  /** Allowed group/room IDs */
  groups: Set<string>;
}

export class Allowlist {
  private channels = new Map<string, ChannelAllowlist>();

  constructor() {
    this.loadFromEnv();
  }

  /**
   * Load allowlists from environment variables.
   *
   * Format:
   *   ALLOWLIST_SIGNAL_MODE=allowlist
   *   ALLOWLIST_SIGNAL_USERS=+821012345678,+821087654321
   *   ALLOWLIST_SIGNAL_GROUPS=group_id_1,group_id_2
   */
  private loadFromEnv(): void {
    const channels = [
      "signal", "matrix", "msteams", "googlechat", "mattermost",
      "nextcloud-talk", "twitch", "nostr", "zalo", "bluebubbles",
      "tlon", "imessage",
    ];

    for (const channel of channels) {
      const envKey = channel.replace(/-/g, "_").toUpperCase();
      const mode = (process.env[`ALLOWLIST_${envKey}_MODE`] ?? "open") as AllowlistMode;
      const usersStr = process.env[`ALLOWLIST_${envKey}_USERS`] ?? "";
      const groupsStr = process.env[`ALLOWLIST_${envKey}_GROUPS`] ?? "";

      this.channels.set(channel, {
        mode,
        users: new Set(usersStr.split(",").map((s) => s.trim()).filter(Boolean)),
        groups: new Set(groupsStr.split(",").map((s) => s.trim()).filter(Boolean)),
      });
    }
  }

  /** Check if a user is allowed to use a channel */
  isAllowed(channel: string, userId: string, groupId?: string): boolean {
    const entry = this.channels.get(channel);

    // Unknown channel: deny by default
    if (!entry) {
      logger.warn("Allowlist check for unknown channel", { channel });
      return false;
    }

    switch (entry.mode) {
      case "open":
        return true;

      case "disabled":
        return false;

      case "allowlist":
        if (entry.users.has(userId)) return true;
        if (groupId && entry.groups.has(groupId)) return true;
        return false;

      default:
        return false;
    }
  }

  /** Add a user to a channel's allowlist */
  addUser(channel: string, userId: string): void {
    const entry = this.channels.get(channel);
    if (entry) {
      entry.users.add(userId);
      logger.info("User added to allowlist", { channel, userId });
    }
  }

  /** Remove a user from a channel's allowlist */
  removeUser(channel: string, userId: string): void {
    const entry = this.channels.get(channel);
    if (entry) {
      entry.users.delete(userId);
      logger.info("User removed from allowlist", { channel, userId });
    }
  }

  /** Set channel mode */
  setMode(channel: string, mode: AllowlistMode): void {
    const entry = this.channels.get(channel);
    if (entry) {
      entry.mode = mode;
      logger.info("Allowlist mode changed", { channel, mode });
    }
  }

  /** Get status for all channels */
  status(): Record<string, { mode: AllowlistMode; userCount: number; groupCount: number }> {
    const result: Record<string, { mode: AllowlistMode; userCount: number; groupCount: number }> = {};
    for (const [channel, entry] of this.channels) {
      result[channel] = {
        mode: entry.mode,
        userCount: entry.users.size,
        groupCount: entry.groups.size,
      };
    }
    return result;
  }
}
