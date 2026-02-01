import { z } from "zod";
import type { KakaoAccountConfig, KakaoConfig, ResolvedKakaoAccount } from "./types.js";

/**
 * Kakao Account Config Zod Schema
 */
export const KakaoAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().default(true),

  // Kakao Developer App Keys
  appKey: z.string().optional(),
  adminKey: z.string().optional(),
  secretKey: z.string().optional(),

  // Kakao Channel
  channelId: z.string().optional(),
  senderKey: z.string().optional(),

  // NHN Cloud Toast (for business messaging)
  toastAppKey: z.string().optional(),
  toastSecretKey: z.string().optional(),

  // Webhook settings
  webhookUrl: z.string().optional(),
  webhookPath: z.string().default("/kakao/webhook"),
  webhookPort: z.number().default(8788),

  // Policies
  dmPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
  allowFrom: z.array(z.string()).optional(),

  // Message settings
  textChunkLimit: z.number().default(1000), // Kakao has shorter limits

  // Timeouts
  timeoutSeconds: z.number().default(30),
});

export const KakaoConfigSchema = z.object({
  accounts: z.record(z.string(), KakaoAccountConfigSchema).optional(),
});

/**
 * Environment variable names for Kakao credentials
 */
const ENV_VAR_NAMES = {
  appKey: ["KAKAO_APP_KEY", "KAKAO_JAVASCRIPT_KEY"],
  adminKey: ["KAKAO_ADMIN_KEY", "KAKAO_REST_API_KEY"],
  secretKey: ["KAKAO_SECRET_KEY"],
  channelId: ["KAKAO_CHANNEL_ID"],
  senderKey: ["KAKAO_SENDER_KEY"],
  toastAppKey: ["TOAST_APP_KEY", "NHN_TOAST_APP_KEY"],
  toastSecretKey: ["TOAST_SECRET_KEY", "NHN_TOAST_SECRET_KEY"],
};

/**
 * Resolve a Kakao credential from config or environment
 */
function resolveCredential(
  config: KakaoAccountConfig,
  key: keyof typeof ENV_VAR_NAMES,
): string | undefined {
  // Check config first
  const configValue = config[key as keyof KakaoAccountConfig];
  if (typeof configValue === "string" && configValue.trim()) {
    return configValue.trim();
  }

  // Check environment variables
  for (const envName of ENV_VAR_NAMES[key]) {
    const envValue = process.env[envName];
    if (envValue?.trim()) {
      return envValue.trim();
    }
  }

  return undefined;
}

/**
 * List all configured Kakao account IDs
 */
export function listKakaoAccountIds(cfg: { channels?: { kakao?: KakaoConfig } }): string[] {
  const kakaoConfig = cfg.channels?.kakao;
  if (!kakaoConfig?.accounts) {
    // Check for single-account config
    return ["default"];
  }
  return Object.keys(kakaoConfig.accounts);
}

/**
 * Resolve a Kakao account configuration
 */
export function resolveKakaoAccount(params: {
  cfg: { channels?: { kakao?: KakaoConfig } };
  accountId?: string | null;
}): ResolvedKakaoAccount | null {
  const { cfg, accountId } = params;
  const kakaoConfig = cfg.channels?.kakao;
  const resolvedAccountId = accountId ?? "default";

  // Get account config
  let accountConfig: KakaoAccountConfig | undefined;

  if (kakaoConfig?.accounts?.[resolvedAccountId]) {
    accountConfig = kakaoConfig.accounts[resolvedAccountId];
  } else if (resolvedAccountId === "default" && kakaoConfig) {
    // Support single-account config at top level
    accountConfig = kakaoConfig as unknown as KakaoAccountConfig;
  }

  if (!accountConfig) {
    return null;
  }

  // Resolve credentials
  const appKey = resolveCredential(accountConfig, "appKey");
  const adminKey = resolveCredential(accountConfig, "adminKey");
  const channelId = resolveCredential(accountConfig, "channelId");
  const senderKey = resolveCredential(accountConfig, "senderKey");
  const toastAppKey = resolveCredential(accountConfig, "toastAppKey");
  const toastSecretKey = resolveCredential(accountConfig, "toastSecretKey");

  // At minimum, we need appKey or adminKey
  if (!appKey && !adminKey) {
    return null;
  }

  return {
    accountId: resolvedAccountId,
    enabled: accountConfig.enabled !== false,
    name: accountConfig.name,
    appKey: appKey ?? "",
    adminKey: adminKey ?? "",
    channelId,
    senderKey,
    toastAppKey,
    toastSecretKey,
    config: accountConfig,
  };
}

/**
 * List all enabled Kakao accounts
 */
export function listEnabledKakaoAccounts(cfg: { channels?: { kakao?: KakaoConfig } }): ResolvedKakaoAccount[] {
  const accountIds = listKakaoAccountIds(cfg);
  const accounts: ResolvedKakaoAccount[] = [];

  for (const accountId of accountIds) {
    const account = resolveKakaoAccount({ cfg, accountId });
    if (account?.enabled) {
      accounts.push(account);
    }
  }

  return accounts;
}

/**
 * Validate Kakao account configuration
 */
export function validateKakaoAccount(account: ResolvedKakaoAccount): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!account.appKey && !account.adminKey) {
    errors.push("Either appKey or adminKey is required");
  }

  if (!account.channelId) {
    warnings.push("channelId not set - some features may be limited");
  }

  if (!account.senderKey && !account.toastAppKey) {
    warnings.push("senderKey or toastAppKey not set - outbound messaging disabled");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get default account config values
 */
export function getDefaultKakaoConfig(): KakaoAccountConfig {
  return {
    enabled: true,
    webhookPath: "/kakao/webhook",
    webhookPort: 8788,
    dmPolicy: "open",
    textChunkLimit: 1000,
    timeoutSeconds: 30,
  };
}
