/**
 * MoA Skill & Tool Credit Pricing Table
 *
 * 실제 API 가격 교차 검증 기반 크레딧 단가표
 * 1 credit = 1 KRW (한국 원화)
 * 환율 기준: 1 USD = 1,350 KRW (2026-02 기준)
 *
 * 원칙:
 * - 무료 API는 0 크레딧
 * - 유료 API는 실제 호출당 단가를 KRW로 환산
 * - MoA 서버 키 사용 시 2x 배율 적용
 */

// ============================================
// Tool/Skill Pricing (per single invocation)
// ============================================

export type PricingTier = "free" | "freemium" | "paid";

export interface ToolPricing {
  /** Tool/Skill identifier */
  toolId: string;
  /** Display name (Korean) */
  name: string;
  /** Category */
  category: ToolCategory;
  /** Cost per invocation in credits (KRW) */
  creditsPerUse: number;
  /** Pricing tier */
  tier: PricingTier;
  /** Whether API key is required */
  requiresApiKey: boolean;
  /** Environment variable for API key */
  envVar?: string;
  /** Actual USD price per call (for reference) */
  usdPerCall?: number;
  /** Provider name */
  provider: string;
  /** Free alternative tool ID (if any) */
  freeAlternative?: string;
  /** Brief description */
  description: string;
}

export type ToolCategory =
  | "weather"
  | "search"
  | "translation"
  | "image"
  | "music"
  | "calendar"
  | "sports"
  | "public_data"
  | "legal"
  | "navigation"
  | "creative"
  | "llm"
  | "utility";

// ============================================
// Cross-Verified Pricing (2026-02)
// ============================================
// Sources verified:
// - OpenAI: https://openai.com/api/pricing
// - Anthropic: https://docs.anthropic.com/en/docs/about-claude/pricing
// - Google: https://ai.google.dev/pricing
// - Perplexity: https://docs.perplexity.ai/guides/pricing
// - Stability AI: https://platform.stability.ai/pricing
// - DeepL: https://www.deepl.com/pro-api
// - Papago: https://developers.naver.com/products/papago
// - KMA: https://data.kma.go.kr (공공데이터포털)
// ============================================

export const TOOL_PRICING: ToolPricing[] = [
  // ━━━━━━━━━━━ FREE (API Key 불필요) ━━━━━━━━━━━
  {
    toolId: "weather_kma",
    name: "기상청 날씨",
    category: "weather",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "KMA (기상청)",
    description: "대한민국 기상청 공공 API (무료)",
  },
  {
    toolId: "calendar",
    name: "일정 조회",
    category: "calendar",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "Local/Kakao",
    description: "사용자 캘린더 조회 (무료)",
  },
  {
    toolId: "sports",
    name: "스포츠 일정",
    category: "sports",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "공공 데이터",
    description: "KBO/K리그/NBA/EPL 경기 일정 (무료)",
  },
  {
    toolId: "public_holidays",
    name: "공휴일 조회",
    category: "public_data",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "공공데이터포털",
    description: "대한민국 공휴일 정보 (무료)",
  },
  {
    toolId: "air_quality",
    name: "대기질 조회",
    category: "public_data",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "에어코리아",
    description: "미세먼지/대기질 정보 (무료)",
  },
  {
    toolId: "qrcode",
    name: "QR 코드 생성",
    category: "creative",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "QR Server API",
    description: "QR 코드 무료 생성",
  },
  {
    toolId: "travel_phrases",
    name: "여행 회화",
    category: "translation",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "내장 데이터베이스",
    description: "상황별 여행 필수 표현 (무료)",
  },
  {
    toolId: "meme_imgflip",
    name: "밈 생성",
    category: "creative",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "Imgflip",
    description: "인터넷 밈 이미지 생성 (무료)",
  },
  {
    toolId: "legal_rag",
    name: "법률 정보 검색",
    category: "legal",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "로컬 RAG",
    description: "법률 문서 검색 (로컬 처리, 무료)",
  },
  {
    toolId: "search_duckduckgo",
    name: "DuckDuckGo 검색",
    category: "search",
    creditsPerUse: 0,
    tier: "free",
    requiresApiKey: false,
    provider: "DuckDuckGo",
    description: "웹 검색 (무료, API 키 불필요)",
  },

  // ━━━━━━━━━━━ FREEMIUM (무료 한도 있음, API Key 필요) ━━━━━━━━━━━
  {
    toolId: "weather_openweather",
    name: "OpenWeatherMap 날씨",
    category: "weather",
    creditsPerUse: 0,
    tier: "freemium",
    requiresApiKey: true,
    envVar: "OPENWEATHER_API_KEY",
    provider: "OpenWeatherMap",
    description: "글로벌 날씨 (무료 1,000회/일)",
    freeAlternative: "weather_kma",
  },
  {
    toolId: "translate_papago",
    name: "파파고 번역",
    category: "translation",
    creditsPerUse: 0,
    tier: "freemium",
    requiresApiKey: true,
    envVar: "NAVER_CLIENT_ID",
    provider: "Naver Papago",
    description: "한/일/영/중 번역 (무료 10,000자/일)",
  },
  {
    toolId: "search_brave",
    name: "Brave 검색",
    category: "search",
    creditsPerUse: 0,
    tier: "freemium",
    requiresApiKey: true,
    envVar: "BRAVE_SEARCH_API_KEY",
    provider: "Brave Search",
    description: "웹 검색 (무료 2,000회/월)",
    freeAlternative: "search_duckduckgo",
  },
  {
    toolId: "freepik_generate",
    name: "Freepik AI 이미지",
    category: "image",
    creditsPerUse: 0,
    tier: "freemium",
    requiresApiKey: true,
    envVar: "FREEPIK_API_KEY",
    provider: "Freepik",
    description: "AI 이미지 생성 (무료 한도 내)",
  },

  // ━━━━━━━━━━━ PAID (유료, 저렴한 순) ━━━━━━━━━━━

  // --- 번역 (유료) ---
  {
    toolId: "translate_google",
    name: "Google 번역",
    category: "translation",
    creditsPerUse: 1,
    tier: "paid",
    requiresApiKey: true,
    envVar: "GOOGLE_TRANSLATE_API_KEY",
    usdPerCall: 0.0004, // $20/1M chars, avg 200 chars/request
    provider: "Google Cloud Translation",
    description: "Google 번역 ($20/백만자)",
    freeAlternative: "translate_papago",
  },
  {
    toolId: "translate_deepl",
    name: "DeepL 번역",
    category: "translation",
    creditsPerUse: 2,
    tier: "paid",
    requiresApiKey: true,
    envVar: "DEEPL_API_KEY",
    usdPerCall: 0.001, // $25/1M chars, avg 400 chars/request
    provider: "DeepL",
    description: "DeepL 번역 ($25/백만자, 유럽어 최고)",
    freeAlternative: "translate_papago",
  },

  // --- 검색 (유료) ---
  {
    toolId: "search_perplexity",
    name: "Perplexity AI 검색",
    category: "search",
    creditsPerUse: 2,
    tier: "paid",
    requiresApiKey: true,
    envVar: "PERPLEXITY_API_KEY",
    usdPerCall: 0.001, // sonar: $1/1000 queries
    provider: "Perplexity AI",
    description: "AI 웹 검색 + 요약 ($1/1000쿼리)",
    freeAlternative: "search_duckduckgo",
  },
  {
    toolId: "search_google_cse",
    name: "Google 커스텀 검색",
    category: "search",
    creditsPerUse: 7,
    tier: "paid",
    requiresApiKey: true,
    envVar: "GOOGLE_CSE_API_KEY",
    usdPerCall: 0.005, // $5/1000 queries
    provider: "Google Custom Search",
    description: "Google 검색 API ($5/1000쿼리)",
    freeAlternative: "search_duckduckgo",
  },

  // --- 이미지 생성 (유료) ---
  {
    toolId: "image_stable_diffusion",
    name: "Stable Diffusion 이미지",
    category: "image",
    creditsPerUse: 10,
    tier: "paid",
    requiresApiKey: true,
    envVar: "STABILITY_API_KEY",
    usdPerCall: 0.006, // $0.002/step * 30 steps = $0.06 → but recent pricing ~$0.006/image
    provider: "Stability AI (SDXL)",
    description: "SDXL 이미지 생성 (~$0.006/장)",
    freeAlternative: "freepik_generate",
  },
  {
    toolId: "image_dalle3_standard",
    name: "DALL-E 3 이미지",
    category: "image",
    creditsPerUse: 54,
    tier: "paid",
    requiresApiKey: true,
    envVar: "OPENAI_API_KEY",
    usdPerCall: 0.04, // $0.04/image (1024x1024 standard)
    provider: "OpenAI (DALL-E 3)",
    description: "DALL-E 3 표준 ($0.04/장)",
    freeAlternative: "freepik_generate",
  },
  {
    toolId: "image_dalle3_hd",
    name: "DALL-E 3 HD 이미지",
    category: "image",
    creditsPerUse: 108,
    tier: "paid",
    requiresApiKey: true,
    envVar: "OPENAI_API_KEY",
    usdPerCall: 0.08, // $0.08/image (1024x1024 HD)
    provider: "OpenAI (DALL-E 3 HD)",
    description: "DALL-E 3 HD ($0.08/장)",
    freeAlternative: "freepik_generate",
  },

  // --- 음악 생성 (유료) ---
  {
    toolId: "music_mubert",
    name: "Mubert 음악",
    category: "music",
    creditsPerUse: 27,
    tier: "paid",
    requiresApiKey: true,
    envVar: "MUBERT_API_KEY",
    usdPerCall: 0.02, // ~$0.02/track
    provider: "Mubert",
    description: "AI 배경음악 생성 (~$0.02/곡)",
  },
  {
    toolId: "music_suno",
    name: "Suno AI 음악",
    category: "music",
    creditsPerUse: 68,
    tier: "paid",
    requiresApiKey: true,
    envVar: "SUNO_API_KEY",
    usdPerCall: 0.05, // $0.05/song
    provider: "Suno AI",
    description: "AI 작곡 ($0.05/곡)",
  },

  // --- 실시간 통역 (유료) ---
  {
    toolId: "live_translate_gemini",
    name: "Gemini 실시간 통역",
    category: "translation",
    creditsPerUse: 3,
    tier: "paid",
    requiresApiKey: true,
    envVar: "GEMINI_API_KEY",
    usdPerCall: 0.002, // Gemini 2.5 Flash: ~$0.002/min audio
    provider: "Google Gemini Live API",
    description: "실시간 음성 통역 40개국어 (~$0.002/분)",
    freeAlternative: "translate_papago",
  },

  // --- 길찾기/지도 (유료) ---
  {
    toolId: "navigation_kakao",
    name: "카카오맵 길찾기",
    category: "navigation",
    creditsPerUse: 1,
    tier: "paid",
    requiresApiKey: true,
    envVar: "KAKAO_MAP_API_KEY",
    usdPerCall: 0.0005,
    provider: "Kakao Maps",
    description: "카카오맵 경로 탐색",
  },
  {
    toolId: "navigation_naver",
    name: "네이버맵 길찾기",
    category: "navigation",
    creditsPerUse: 1,
    tier: "paid",
    requiresApiKey: true,
    envVar: "NAVER_MAP_API_KEY",
    usdPerCall: 0.0005,
    provider: "Naver Maps",
    description: "네이버맵 경로 탐색",
  },
];

// ============================================
// LLM Model Credit Pricing (per conversation)
// ============================================

export interface LlmPricing {
  modelId: string;
  provider: string;
  name: string;
  /** Input cost per 1M tokens in USD */
  inputUsdPer1M: number;
  /** Output cost per 1M tokens in USD */
  outputUsdPer1M: number;
  /** Simplified credits per average conversation (~1K input + 2K output tokens) */
  creditsPerConversation: number;
  /** Is this model available for free? */
  freeTier: boolean;
}

export const LLM_PRICING: LlmPricing[] = [
  // Free tier models
  {
    modelId: "groq/kimi-k2-0905",
    provider: "Groq",
    name: "Kimi K2 (Groq)",
    inputUsdPer1M: 0,
    outputUsdPer1M: 0,
    creditsPerConversation: 0,
    freeTier: true,
  },
  {
    modelId: "groq/llama-3.3-70b",
    provider: "Groq",
    name: "Llama 3.3 70B (Groq)",
    inputUsdPer1M: 0,
    outputUsdPer1M: 0,
    creditsPerConversation: 0,
    freeTier: true,
  },
  // Very cheap
  {
    modelId: "deepseek/deepseek-chat",
    provider: "DeepSeek",
    name: "DeepSeek Chat",
    inputUsdPer1M: 0.14,
    outputUsdPer1M: 0.28,
    creditsPerConversation: 1,
    freeTier: false,
  },
  {
    modelId: "gemini/gemini-2.5-flash",
    provider: "Google",
    name: "Gemini 2.5 Flash",
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.60,
    creditsPerConversation: 2,
    freeTier: false,
  },
  {
    modelId: "openai/gpt-4o-mini",
    provider: "OpenAI",
    name: "GPT-4o Mini",
    inputUsdPer1M: 0.15,
    outputUsdPer1M: 0.60,
    creditsPerConversation: 2,
    freeTier: false,
  },
  // Mid range
  {
    modelId: "anthropic/claude-haiku-4-5",
    provider: "Anthropic",
    name: "Claude Haiku 4.5",
    inputUsdPer1M: 0.80,
    outputUsdPer1M: 4.00,
    creditsPerConversation: 6,
    freeTier: false,
  },
  {
    modelId: "mistral/mistral-small-latest",
    provider: "Mistral",
    name: "Mistral Small",
    inputUsdPer1M: 0.20,
    outputUsdPer1M: 0.60,
    creditsPerConversation: 2,
    freeTier: false,
  },
  // Expensive
  {
    modelId: "openai/gpt-4o",
    provider: "OpenAI",
    name: "GPT-4o",
    inputUsdPer1M: 2.50,
    outputUsdPer1M: 10.00,
    creditsPerConversation: 15,
    freeTier: false,
  },
  {
    modelId: "anthropic/claude-sonnet-4-5",
    provider: "Anthropic",
    name: "Claude Sonnet 4.5",
    inputUsdPer1M: 3.00,
    outputUsdPer1M: 15.00,
    creditsPerConversation: 22,
    freeTier: false,
  },
  {
    modelId: "gemini/gemini-3-pro",
    provider: "Google",
    name: "Gemini 3 Pro",
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 5.00,
    creditsPerConversation: 8,
    freeTier: false,
  },
  // Premium
  {
    modelId: "openai/gpt-5",
    provider: "OpenAI",
    name: "GPT-5",
    inputUsdPer1M: 5.00,
    outputUsdPer1M: 15.00,
    creditsPerConversation: 25,
    freeTier: false,
  },
  {
    modelId: "anthropic/claude-opus-4-6",
    provider: "Anthropic",
    name: "Claude Opus 4.6",
    inputUsdPer1M: 15.00,
    outputUsdPer1M: 75.00,
    creditsPerConversation: 100,
    freeTier: false,
  },
];

// ============================================
// Helper Functions
// ============================================

/** Get tool pricing by ID */
export function getToolPricing(toolId: string): ToolPricing | undefined {
  return TOOL_PRICING.find((t) => t.toolId === toolId);
}

/** Get all tools for a category, sorted by cost (cheapest first) */
export function getToolsByCategory(category: ToolCategory): ToolPricing[] {
  return TOOL_PRICING
    .filter((t) => t.category === category)
    .sort((a, b) => a.creditsPerUse - b.creditsPerUse);
}

/** Get all free tools */
export function getFreeTools(): ToolPricing[] {
  return TOOL_PRICING.filter((t) => t.tier === "free");
}

/** Get freemium tools (free with API key) */
export function getFreemiumTools(): ToolPricing[] {
  return TOOL_PRICING.filter((t) => t.tier === "freemium");
}

/** Get paid tools sorted by cost ascending */
export function getPaidToolsSorted(): ToolPricing[] {
  return TOOL_PRICING
    .filter((t) => t.tier === "paid")
    .sort((a, b) => a.creditsPerUse - b.creditsPerUse);
}

/** Get LLM pricing by model ID */
export function getLlmPricing(modelId: string): LlmPricing | undefined {
  return LLM_PRICING.find((m) => m.modelId === modelId);
}

/** Get cheapest LLM for a given task */
export function getCheapestLlm(excludeFree = false): LlmPricing {
  const models = excludeFree
    ? LLM_PRICING.filter((m) => !m.freeTier)
    : LLM_PRICING;
  return models.sort((a, b) => a.creditsPerConversation - b.creditsPerConversation)[0];
}

/** MoA server key multiplier */
export const MOA_SERVER_KEY_MULTIPLIER = 2;

/** Apply MoA server key multiplier to cost */
export function applyServerKeyMultiplier(credits: number, useMoaKey: boolean): number {
  return useMoaKey ? credits * MOA_SERVER_KEY_MULTIPLIER : credits;
}

/** Format credits for display */
export function formatCreditsCompact(credits: number): string {
  if (credits === 0) return "무료";
  if (credits < 10) return `${credits}C`;
  if (credits >= 10000) return `${(credits / 10000).toFixed(1)}만C`;
  return `${credits.toLocaleString()}C`;
}

/**
 * Format full pricing table as text (for user display)
 */
export function formatPricingTable(): string {
  const lines: string[] = [];

  lines.push("━━ MoA 크레딧 단가표 ━━\n");
  lines.push("1 크레딧 = 1원 (KRW)\n");

  // Free tools
  lines.push("[ 무료 도구 (API키 불필요) ]");
  for (const tool of TOOL_PRICING.filter((t) => t.tier === "free")) {
    lines.push(`  ${tool.name}: 무료`);
  }

  lines.push("");
  lines.push("[ 무료 도구 (API키 필요) ]");
  for (const tool of TOOL_PRICING.filter((t) => t.tier === "freemium")) {
    lines.push(`  ${tool.name}: 무료 (${tool.envVar})`);
  }

  lines.push("");
  lines.push("[ 유료 도구 (저렴한 순) ]");
  const paidTools = getPaidToolsSorted();
  for (const tool of paidTools) {
    const usd = tool.usdPerCall ? ` ($${tool.usdPerCall})` : "";
    lines.push(`  ${tool.name}: ${tool.creditsPerUse}C/회${usd}`);
  }

  lines.push("");
  lines.push("[ LLM 모델 (대화당) ]");
  const sortedLlm = [...LLM_PRICING].sort(
    (a, b) => a.creditsPerConversation - b.creditsPerConversation,
  );
  for (const llm of sortedLlm) {
    const tag = llm.freeTier ? " [무료]" : "";
    lines.push(`  ${llm.name}: ${llm.creditsPerConversation}C/대화${tag}`);
  }

  lines.push("\n* MoA 서버 키 사용 시 2배 적용");
  lines.push("* 본인 API 키 사용 시 크레딧 차감 없음");

  return lines.join("\n");
}
