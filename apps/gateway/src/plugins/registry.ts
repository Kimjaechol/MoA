/**
 * Plugin Registry
 *
 * Manages channel plugin lifecycle: registration, initialization, lookup.
 * Benchmarked from OpenClaw's dock/channel registry pattern.
 */

import type { GatewayConfig } from "../config.js";
import type { ChannelPlugin, GatewayChannel } from "./types.js";
import { logger } from "../logger.js";

class PluginRegistry {
  private plugins = new Map<GatewayChannel, ChannelPlugin>();
  private initialized = new Set<GatewayChannel>();

  /** Register a plugin (called at import time) */
  register(plugin: ChannelPlugin): void {
    if (this.plugins.has(plugin.channel)) {
      logger.warn("Plugin already registered, overwriting", { channel: plugin.channel });
    }
    this.plugins.set(plugin.channel, plugin);
    logger.debug("Plugin registered", { channel: plugin.channel, name: plugin.displayName });
  }

  /** Initialize all configured plugins */
  async initializeAll(config: GatewayConfig): Promise<void> {
    const results: { channel: string; status: string }[] = [];

    for (const [channel, plugin] of this.plugins) {
      if (!plugin.isConfigured(config)) {
        results.push({ channel, status: "skipped (not configured)" });
        continue;
      }

      try {
        await plugin.initialize(config);
        this.initialized.add(channel);
        results.push({ channel, status: "ok" });
        logger.info("Plugin initialized", { channel, name: plugin.displayName });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ channel, status: `error: ${message}` });
        logger.error("Plugin initialization failed", { channel, error: message });
      }
    }

    logger.info("Plugin initialization complete", {
      total: this.plugins.size,
      active: this.initialized.size,
      results,
    });
  }

  /** Get an active (initialized) plugin by channel */
  get(channel: GatewayChannel): ChannelPlugin | undefined {
    if (!this.initialized.has(channel)) return undefined;
    return this.plugins.get(channel);
  }

  /** Get all active plugins */
  getActive(): ChannelPlugin[] {
    return Array.from(this.initialized).map(
      (ch) => this.plugins.get(ch)!,
    );
  }

  /** Get all registered plugins (active + inactive) */
  getAll(): ChannelPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Find the plugin that should handle a webhook path */
  findByWebhookPath(path: string): ChannelPlugin | undefined {
    // Webhook paths follow pattern: /webhook/:channel
    const match = path.match(/^\/webhook\/([a-z-]+)/);
    if (!match) return undefined;
    const channel = match[1] as GatewayChannel;
    return this.get(channel);
  }

  /** Shutdown all active plugins */
  async shutdownAll(): Promise<void> {
    for (const channel of this.initialized) {
      const plugin = this.plugins.get(channel);
      if (plugin) {
        try {
          await plugin.shutdown();
          logger.info("Plugin shut down", { channel });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Plugin shutdown error", { channel, error: message });
        }
      }
    }
    this.initialized.clear();
  }

  /** Status summary for health check */
  status(): Record<string, { displayName: string; active: boolean }> {
    const result: Record<string, { displayName: string; active: boolean }> = {};
    for (const [channel, plugin] of this.plugins) {
      result[channel] = {
        displayName: plugin.displayName,
        active: this.initialized.has(channel),
      };
    }
    return result;
  }
}

/** Singleton registry */
export const registry = new PluginRegistry();
