/**
 * Gateway Configuration
 *
 * All configuration is loaded from environment variables.
 * Required: MOA_API_URL, MOA_API_SECRET
 * Optional: per-channel env vars (loaded when adapter initializes)
 */

export interface GatewayConfig {
  // Core
  port: number;
  host: string;
  env: "production" | "development";

  // MoA Web API connection
  moaApiUrl: string;
  moaApiSecret: string;

  // OpenClaw Agent integration (optional)
  // When configured, the gateway routes messages through the OpenClaw agent
  // for enhanced capabilities (tools, skills, memory, browser automation).
  openclawGatewayUrl?: string;
  openclawGatewayToken?: string;
  openclawTimeoutMs: number;

  // Security
  rateLimitPerMinute: number;
  maxStrikes: number;
  strikeCooldownMs: number;

  // Signal (via signal-cli REST API)
  signalCliUrl?: string;
  signalPhone?: string;

  // Matrix
  matrixHomeserverUrl?: string;
  matrixAccessToken?: string;
  matrixUserId?: string;

  // MS Teams (Bot Framework)
  teamsAppId?: string;
  teamsAppPassword?: string;

  // Google Chat (Webhook / Service Account)
  googleChatServiceAccountJson?: string;

  // Mattermost
  mattermostUrl?: string;
  mattermostToken?: string;

  // Nextcloud Talk
  nextcloudUrl?: string;
  nextcloudUser?: string;
  nextcloudPassword?: string;

  // Zalo
  zaloOaAccessToken?: string;
  zaloOaSecretKey?: string;
}

export function loadConfig(): GatewayConfig {
  const moaApiUrl = process.env.MOA_API_URL;
  const moaApiSecret = process.env.MOA_API_SECRET;

  if (!moaApiUrl) {
    throw new Error("MOA_API_URL is required (e.g. https://mymoa.app)");
  }
  if (!moaApiSecret) {
    throw new Error("MOA_API_SECRET is required for authenticating with MoA API");
  }

  return {
    port: parseInt(process.env.GATEWAY_PORT ?? "8900", 10),
    host: process.env.GATEWAY_HOST ?? "0.0.0.0",
    env: process.env.NODE_ENV === "production" ? "production" : "development",

    moaApiUrl: moaApiUrl.replace(/\/$/, ""),
    moaApiSecret,

    // OpenClaw agent integration (optional — enhances AI responses with tools/skills/memory)
    openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
    openclawGatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    openclawTimeoutMs: parseInt(process.env.OPENCLAW_TIMEOUT_MS ?? "90000", 10),

    rateLimitPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? "30", 10),
    maxStrikes: parseInt(process.env.MAX_STRIKES ?? "3", 10),
    strikeCooldownMs: parseInt(process.env.STRIKE_COOLDOWN_MS ?? "1800000", 10),

    signalCliUrl: process.env.SIGNAL_CLI_URL,
    signalPhone: process.env.SIGNAL_PHONE,

    matrixHomeserverUrl: process.env.MATRIX_HOMESERVER_URL,
    matrixAccessToken: process.env.MATRIX_ACCESS_TOKEN,
    matrixUserId: process.env.MATRIX_USER_ID,

    teamsAppId: process.env.TEAMS_APP_ID,
    teamsAppPassword: process.env.TEAMS_APP_PASSWORD,

    googleChatServiceAccountJson: process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON,

    mattermostUrl: process.env.MATTERMOST_URL,
    mattermostToken: process.env.MATTERMOST_TOKEN,

    nextcloudUrl: process.env.NEXTCLOUD_URL,
    nextcloudUser: process.env.NEXTCLOUD_USER,
    nextcloudPassword: process.env.NEXTCLOUD_PASSWORD,

    zaloOaAccessToken: process.env.ZALO_OA_ACCESS_TOKEN,
    zaloOaSecretKey: process.env.ZALO_OA_SECRET_KEY,
  };
}
