/**
 * Adapter Registration
 *
 * Registers all channel adapters with the plugin registry.
 * Configured adapters will be initialized at startup.
 */

import { registry } from "../plugins/registry.js";
import { SignalAdapter } from "./signal.js";
import { MatrixAdapter } from "./matrix.js";
import { MSTeamsAdapter } from "./msteams.js";
import { GoogleChatAdapter } from "./googlechat.js";
import { MattermostAdapter } from "./mattermost.js";
import { NextcloudTalkAdapter } from "./nextcloud-talk.js";
import { ZaloAdapter } from "./zalo.js";
import { createGenericAdapter } from "./generic-webhook.js";

export function registerAllAdapters(): void {
  // Protocol-specific adapters
  registry.register(new SignalAdapter());
  registry.register(new MatrixAdapter());
  registry.register(new MSTeamsAdapter());
  registry.register(new GoogleChatAdapter());
  registry.register(new MattermostAdapter());
  registry.register(new NextcloudTalkAdapter());
  registry.register(new ZaloAdapter());

  // Generic webhook adapters for simpler integrations
  registry.register(
    createGenericAdapter(
      "twitch",
      "Twitch",
      () => !!process.env.TWITCH_WEBHOOK_SECRET,
    ),
  );

  registry.register(
    createGenericAdapter(
      "nostr",
      "Nostr",
      () => !!process.env.NOSTR_RELAY_URL,
    ),
  );

  registry.register(
    createGenericAdapter(
      "bluebubbles",
      "BlueBubbles",
      () => !!process.env.BLUEBUBBLES_URL,
    ),
  );

  registry.register(
    createGenericAdapter(
      "tlon",
      "Tlon (Urbit)",
      () => !!process.env.TLON_SHIP_URL,
    ),
  );

  registry.register(
    createGenericAdapter(
      "imessage",
      "iMessage",
      () => !!process.env.IMESSAGE_BRIDGE_URL,
    ),
  );
}
