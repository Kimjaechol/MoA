/**
 * Complexity Classifier - 질문 복잡도 분류기
 *
 * 사용자 메시지의 복잡도를 분석하여 적절한 AI 모델을 추천합니다.
 *
 * 복잡도 레벨:
 * - simple (1): 간단한 인사, 단순 질문 → 무료 모델
 * - general (2): 일반 대화, 정보 요청 → 저렴한 모델
 * - complex (3): 분석, 비교, 설명 요청 → 중급 모델
 * - expert (4-5): 코드 작성, 전문 분석 → 고급 모델
 */

// ============================================
// Types
// ============================================

export type ComplexityLevel = "simple" | "general" | "complex" | "expert";

export type SuggestedModelTier = "free" | "cheap" | "premium" | "local";

export interface ComplexityResult {
  level: ComplexityLevel;
  score: number; // 1-5
  reason: string;
  reasonEn: string;
  suggestedTier: SuggestedModelTier;
  requiresUserConfirmation: boolean;
  estimatedTokens: number;
}

export interface ComplexityFactors {
  wordCount: number;
  sentenceCount: number;
  hasCode: boolean;
  hasMultipleQuestions: boolean;
  hasAnalysisRequest: boolean;
  hasComparisonRequest: boolean;
  hasCreativeRequest: boolean;
  hasExpertDomain: boolean;
  hasSimpleGreeting: boolean;
  hasLongContext: boolean;
}

// ============================================
// Patterns
// ============================================

// 간단한 인사/질문 패턴
const SIMPLE_PATTERNS = [
  /^(안녕|ㅎㅇ|하이|헬로|hi|hello|hey)/i,
  /^(네|응|ㅇㅇ|ㄱㄱ|ㅇㅋ|ok|okay|yes|no)/i,
  /^(뭐해|뭐하니|뭐해요)/,
  /^(ㅋ+|ㅎ+|lol|haha)/i,
  /^(고마워|감사|땡큐|thanks|thx)/i,
  /^(잘가|바이|bye)/i,
];

// 분석/비교 요청 패턴
const ANALYSIS_PATTERNS = [
  /분석|분석해|분석해줘/,
  /비교|비교해|비교해줘/,
  /설명|설명해|설명해줘/,
  /왜\s*.+인가|왜\s*.+인지|왜\s*.+야/,
  /어떻게\s*.+하는|어떻게\s*.+해야/,
  /차이점|차이가|다른\s*점/,
  /장단점|장점.*단점|pros.*cons/i,
  /요약|요약해|정리해/,
  /평가|리뷰|검토/,
];

// 코드/기술 관련 패턴
const CODE_PATTERNS = [
  /```[\s\S]*```/, // 코드 블록
  /function\s+\w+|const\s+\w+|let\s+\w+|var\s+\w+/,
  /class\s+\w+|import\s+.*from/,
  /def\s+\w+|async\s+def/,
  /<\w+>.*<\/\w+>/, // HTML/XML
  /SELECT\s+.*FROM|INSERT\s+INTO/i, // SQL
  /코드\s*(작성|짜|만들|수정|리팩토링)/,
  /버그\s*(수정|찾|고쳐)/,
  /프로그래밍|개발|구현/,
  /알고리즘|자료구조|시간복잡도/,
  /API|REST|GraphQL|SDK/i,
];

// 창작 요청 패턴
const CREATIVE_PATTERNS = [
  /글\s*(써|작성|만들)/,
  /시\s*(써|지어|만들)/,
  /소설|이야기|스토리/,
  /에세이|보고서|논문/,
  /대본|시나리오|각본/,
  /노래\s*가사|작사/,
  /블로그|포스트|게시글/,
];

// 전문 분야 패턴
const EXPERT_DOMAIN_PATTERNS = [
  // 법률
  /법률|법령|조항|판례|소송|계약서/,
  // 의료
  /진단|처방|증상|치료|수술|의학/,
  // 금융
  /투자|주식|펀드|채권|파생상품|포트폴리오/,
  // 세무/회계
  /세금|세무|회계|재무제표|손익계산/,
  // 기술
  /아키텍처|시스템\s*설계|인프라|클라우드/,
  /머신러닝|딥러닝|AI\s*모델|신경망/i,
  // 학술
  /논문|학술|연구|가설|실험/,
];

// ============================================
// Helper Functions
// ============================================

/**
 * 메시지에서 복잡도 요소 추출
 */
function extractFactors(message: string): ComplexityFactors {
  const words = message.split(/\s+/).filter(w => w.length > 0);
  const sentences = message.split(/[.!?。！？]+/).filter(s => s.trim().length > 0);

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    hasCode: CODE_PATTERNS.some(p => p.test(message)),
    hasMultipleQuestions: (message.match(/\?|？/g) || []).length > 1,
    hasAnalysisRequest: ANALYSIS_PATTERNS.some(p => p.test(message)),
    hasComparisonRequest: /비교|차이|vs|versus/i.test(message),
    hasCreativeRequest: CREATIVE_PATTERNS.some(p => p.test(message)),
    hasExpertDomain: EXPERT_DOMAIN_PATTERNS.some(p => p.test(message)),
    hasSimpleGreeting: SIMPLE_PATTERNS.some(p => p.test(message.trim())),
    hasLongContext: message.length > 500,
  };
}

/**
 * 토큰 수 추정 (한국어 기준)
 */
function estimateTokenCount(message: string): number {
  // 한국어: 약 2-3자당 1토큰
  // 영어: 약 4자당 1토큰
  const koreanChars = (message.match(/[가-힣]/g) || []).length;
  const otherChars = message.length - koreanChars;

  return Math.ceil(koreanChars / 2.5 + otherChars / 4);
}

// ============================================
// Main Classifier
// ============================================

/**
 * 규칙 기반 복잡도 분류
 *
 * 빠르고 무료로 실행 가능 (~0ms)
 */
export function classifyComplexity(message: string): ComplexityResult {
  const factors = extractFactors(message);
  const estimatedTokens = estimateTokenCount(message);

  // 1. 간단한 인사/단답 (레벨 1)
  if (factors.hasSimpleGreeting && factors.wordCount < 10) {
    return {
      level: "simple",
      score: 1,
      reason: "간단한 인사 또는 단답",
      reasonEn: "Simple greeting or short answer",
      suggestedTier: "free",
      requiresUserConfirmation: false,
      estimatedTokens,
    };
  }

  // 2. 매우 짧은 질문 (레벨 1)
  if (factors.wordCount < 5 && !factors.hasCode && !factors.hasExpertDomain) {
    return {
      level: "simple",
      score: 1,
      reason: "짧은 단순 질문",
      reasonEn: "Short simple question",
      suggestedTier: "free",
      requiresUserConfirmation: false,
      estimatedTokens,
    };
  }

  // 점수 계산
  let score = 2; // 기본 점수

  // 코드 관련 → +2
  if (factors.hasCode) { score += 2; }

  // 전문 분야 → +2
  if (factors.hasExpertDomain) { score += 2; }

  // 창작 요청 → +1
  if (factors.hasCreativeRequest) { score += 1; }

  // 분석/비교 요청 → +1
  if (factors.hasAnalysisRequest || factors.hasComparisonRequest) { score += 1; }

  // 복수 질문 → +1
  if (factors.hasMultipleQuestions) { score += 1; }

  // 긴 컨텍스트 → +1
  if (factors.hasLongContext) { score += 1; }

  // 긴 문장 (20단어 이상) → +0.5
  if (factors.wordCount > 20) { score += 0.5; }
  if (factors.wordCount > 50) { score += 0.5; }

  // 점수 정규화 (1-5)
  score = Math.min(5, Math.max(1, Math.round(score)));

  // 레벨 및 추천 모델 결정
  if (score <= 1) {
    return {
      level: "simple",
      score,
      reason: "단순 질문",
      reasonEn: "Simple question",
      suggestedTier: "free",
      requiresUserConfirmation: false,
      estimatedTokens,
    };
  }

  if (score <= 2) {
    return {
      level: "general",
      score,
      reason: "일반적인 대화 또는 정보 요청",
      reasonEn: "General conversation or information request",
      suggestedTier: "cheap",
      requiresUserConfirmation: false,
      estimatedTokens,
    };
  }

  if (score <= 3) {
    return {
      level: "complex",
      score,
      reason: buildComplexReason(factors),
      reasonEn: buildComplexReasonEn(factors),
      suggestedTier: "cheap", // 중급도 저렴한 모델로 시도
      requiresUserConfirmation: false,
      estimatedTokens,
    };
  }

  // 고급 (4-5)
  return {
    level: "expert",
    score,
    reason: buildExpertReason(factors),
    reasonEn: buildExpertReasonEn(factors),
    suggestedTier: "premium",
    requiresUserConfirmation: true, // 사용자 확인 필요!
    estimatedTokens,
  };
}

function buildComplexReason(factors: ComplexityFactors): string {
  const reasons: string[] = [];
  if (factors.hasAnalysisRequest) { reasons.push("분석 요청"); }
  if (factors.hasComparisonRequest) { reasons.push("비교 요청"); }
  if (factors.hasCreativeRequest) { reasons.push("창작 요청"); }
  if (factors.hasMultipleQuestions) { reasons.push("복수 질문"); }
  return reasons.length > 0 ? reasons.join(", ") : "복잡한 질문";
}

function buildComplexReasonEn(factors: ComplexityFactors): string {
  const reasons: string[] = [];
  if (factors.hasAnalysisRequest) { reasons.push("analysis request"); }
  if (factors.hasComparisonRequest) { reasons.push("comparison request"); }
  if (factors.hasCreativeRequest) { reasons.push("creative request"); }
  if (factors.hasMultipleQuestions) { reasons.push("multiple questions"); }
  return reasons.length > 0 ? reasons.join(", ") : "complex question";
}

function buildExpertReason(factors: ComplexityFactors): string {
  const reasons: string[] = [];
  if (factors.hasCode) { reasons.push("코드/기술 분석"); }
  if (factors.hasExpertDomain) { reasons.push("전문 분야"); }
  if (factors.hasCreativeRequest) { reasons.push("고급 창작"); }
  if (factors.hasLongContext) { reasons.push("긴 컨텍스트"); }
  return reasons.length > 0 ? reasons.join(", ") : "전문가 수준 분석";
}

function buildExpertReasonEn(factors: ComplexityFactors): string {
  const reasons: string[] = [];
  if (factors.hasCode) { reasons.push("code/technical analysis"); }
  if (factors.hasExpertDomain) { reasons.push("expert domain"); }
  if (factors.hasCreativeRequest) { reasons.push("advanced creative"); }
  if (factors.hasLongContext) { reasons.push("long context"); }
  return reasons.length > 0 ? reasons.join(", ") : "expert-level analysis";
}

// ============================================
// Premium Model Notification
// ============================================

export interface PremiumModelNotification {
  required: boolean;
  message: string;
  messageEn: string;
  suggestedModels: Array<{
    provider: string;
    model: string;
    displayName: string;
  }>;
  userHasApiKey: boolean;
  creditRequired: boolean;
}

/**
 * 고급 모델 필요시 알림 메시지 생성
 */
export function buildPremiumModelNotification(
  complexity: ComplexityResult,
  userHasApiKey: boolean,
  userCredits: number,
): PremiumModelNotification {
  if (!complexity.requiresUserConfirmation) {
    return {
      required: false,
      message: "",
      messageEn: "",
      suggestedModels: [],
      userHasApiKey,
      creditRequired: false,
    };
  }

  const suggestedModels = [
    { provider: "anthropic", model: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5" },
    { provider: "openai", model: "gpt-5.2", displayName: "OpenAI GPT-5.2" },
    { provider: "google", model: "gemini-3-pro-preview", displayName: "Gemini 3 Pro" },
  ];

  const _modelNames = suggestedModels.map(m => `"${m.displayName}"`).join(", ");

  if (userHasApiKey) {
    // 사용자가 이미 API 키를 등록한 경우 → 자동 사용
    return {
      required: false, // 확인 불필요, 자동 진행
      message: `🧠 복잡한 요청이 감지되어 고급 모델을 사용합니다.\n\n📊 복잡도: ${complexity.score}/5 (${complexity.reason})`,
      messageEn: `🧠 Complex request detected. Using premium model.\n\n📊 Complexity: ${complexity.score}/5 (${complexity.reasonEn})`,
      suggestedModels,
      userHasApiKey: true,
      creditRequired: false,
    };
  }

  // 사용자가 API 키가 없는 경우 → 안내 필요
  const hasEnoughCredits = userCredits >= 100; // 최소 100 크레딧 필요

  const message = `⚠️ 이 요청은 복잡해서 고급 AI 모델이 필요합니다.

📊 복잡도: ${complexity.score}/5 (${complexity.reason})

🤖 사용 가능한 고급 모델:
${suggestedModels.map(m => `  • ${m.displayName}`).join("\n")}

💡 선택하세요:
1️⃣ 직접 API 키 등록하기 (무료 사용)
   → "API키 등록" 이라고 입력

2️⃣ MoA 크레딧으로 사용하기
   → 현재 잔액: ${userCredits} 크레딧
   ${hasEnoughCredits ? "→ \"고급모델 사용\" 이라고 입력" : "→ 크레딧이 부족합니다. \"충전\" 이라고 입력"}

3️⃣ 무료 모델로 시도하기 (품질 저하 가능)
   → "무료로 시도" 라고 입력`;

  const messageEn = `⚠️ This request requires a premium AI model due to complexity.

📊 Complexity: ${complexity.score}/5 (${complexity.reasonEn})

🤖 Available premium models:
${suggestedModels.map(m => `  • ${m.displayName}`).join("\n")}

💡 Options:
1️⃣ Register your own API key (free usage)
   → Type "register API key"

2️⃣ Use MoA credits
   → Current balance: ${userCredits} credits
   ${hasEnoughCredits ? '→ Type "use premium model"' : '→ Insufficient credits. Type "recharge"'}

3️⃣ Try with free model (quality may be lower)
   → Type "try free"`;

  return {
    required: true,
    message,
    messageEn,
    suggestedModels,
    userHasApiKey: false,
    creditRequired: !hasEnoughCredits,
  };
}

// ============================================
// Quick Response Check
// ============================================

/**
 * 복잡도 기반 빠른 응답 가능 여부 확인
 *
 * 간단한 질문은 빠른 무료 모델로 즉시 응답 가능
 */
export function canQuickResponse(complexity: ComplexityResult): boolean {
  return complexity.level === "simple" && complexity.score <= 1;
}

/**
 * 복잡도 레벨에 따른 추천 모델 목록
 */
export function getRecommendedModels(tier: SuggestedModelTier): Array<{
  provider: string;
  model: string;
  displayName: string;
  isFree: boolean;
}> {
  switch (tier) {
    case "free":
      return [
        { provider: "google", model: "gemini-2.0-flash", displayName: "Gemini 2.0 Flash", isFree: true },
        { provider: "groq", model: "llama-3.3-70b-versatile", displayName: "Llama 3.3 70B (Groq)", isFree: true },
      ];

    case "cheap":
      return [
        { provider: "anthropic", model: "claude-3-5-haiku-latest", displayName: "Claude 3.5 Haiku", isFree: false },
        { provider: "openai", model: "gpt-4o-mini", displayName: "GPT-4o Mini", isFree: false },
        { provider: "google", model: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro", isFree: false },
      ];

    case "premium":
      return [
        { provider: "anthropic", model: "claude-opus-4-5-20251101", displayName: "Claude Opus 4.5", isFree: false },
        { provider: "openai", model: "gpt-5.2", displayName: "GPT-5.2", isFree: false },
        { provider: "google", model: "gemini-3-pro-preview", displayName: "Gemini 3 Pro", isFree: false },
      ];

    case "local":
      return [
        { provider: "local", model: "llama-3.2-3b", displayName: "Llama 3.2 3B (Local)", isFree: true },
        { provider: "local", model: "mistral-7b", displayName: "Mistral 7B (Local)", isFree: true },
      ];

    default:
      return [];
  }
}

/**
 * 복잡도 정보를 간단한 이모지로 표시
 */
export function getComplexityEmoji(level: ComplexityLevel): string {
  switch (level) {
    case "simple":
      return "🟢";
    case "general":
      return "🟡";
    case "complex":
      return "🟠";
    case "expert":
      return "🔴";
  }
}

/**
 * 복잡도 정보를 한 줄 요약
 */
export function formatComplexitySummary(complexity: ComplexityResult): string {
  const emoji = getComplexityEmoji(complexity.level);
  return `${emoji} 복잡도: ${complexity.score}/5 (${complexity.reason})`;
}
