/**
 * LawCall Router
 *
 * Routes legal questions to appropriate LawCall category pages.
 * Categories are loaded from LAWCALL_ROUTES environment variable.
 */

export interface LawCallCategory {
  name: string;
  url: string;
  keywords: string[];
  description: string;
}

export interface LawCallRoutes {
  categories: LawCallCategory[];
  defaultUrl: string;
  lawyerName: string;
  serviceName: string;
}

/**
 * Default routes (used if LAWCALL_ROUTES not set)
 */
const DEFAULT_ROUTES: LawCallRoutes = {
  categories: [
    {
      name: "민사",
      url: "https://lawcall.example.com/civil",
      keywords: ["계약", "손해배상", "채권", "부동산", "전세", "임대차", "매매", "대출", "보증금"],
      description: "계약, 손해배상, 부동산 분쟁",
    },
    {
      name: "형사",
      url: "https://lawcall.example.com/criminal",
      keywords: ["고소", "폭행", "사기", "횡령", "명예훼손", "협박", "성범죄", "음주운전", "교통사고"],
      description: "형사 고소/고발, 피해자 대리",
    },
    {
      name: "이혼/가사",
      url: "https://lawcall.example.com/family",
      keywords: ["이혼", "양육권", "위자료", "재산분할", "상속", "유언", "친권", "면접교섭"],
      description: "이혼, 양육권, 상속 문제",
    },
    {
      name: "세무",
      url: "https://lawcall.example.com/tax",
      keywords: ["세금", "국세", "조세", "세무조사", "탈세", "종합소득세", "양도세", "증여세"],
      description: "세무조사, 조세불복",
    },
    {
      name: "행정",
      url: "https://lawcall.example.com/admin",
      keywords: ["허가", "인허가", "행정처분", "과징금", "영업정지", "면허취소"],
      description: "행정처분 취소, 인허가",
    },
    {
      name: "헌법재판",
      url: "https://lawcall.example.com/constitutional",
      keywords: ["위헌", "헌법소원", "기본권", "헌법재판소"],
      description: "헌법소원, 위헌법률심판",
    },
  ],
  defaultUrl: "https://lawcall.example.com",
  lawyerName: "김재철 변호사",
  serviceName: "LawCall",
};

let cachedRoutes: LawCallRoutes | null = null;

/**
 * Parse LAWCALL_ROUTES from environment variable
 *
 * Format 1 (Simple): {"민사":"url","형사":"url",...}
 * Format 2 (Full): {"categories":[...],"defaultUrl":"...","lawyerName":"..."}
 */
export function parseLawCallRoutes(): LawCallRoutes {
  if (cachedRoutes) return cachedRoutes;

  const envValue = process.env.LAWCALL_ROUTES;

  if (!envValue) {
    cachedRoutes = DEFAULT_ROUTES;
    return cachedRoutes;
  }

  try {
    const parsed = JSON.parse(envValue);

    // Format 2: Full config
    if (parsed.categories && Array.isArray(parsed.categories)) {
      cachedRoutes = {
        categories: parsed.categories,
        defaultUrl: parsed.defaultUrl ?? DEFAULT_ROUTES.defaultUrl,
        lawyerName: parsed.lawyerName ?? DEFAULT_ROUTES.lawyerName,
        serviceName: parsed.serviceName ?? DEFAULT_ROUTES.serviceName,
      };
      return cachedRoutes;
    }

    // Format 1: Simple key-value mapping
    const categories: LawCallCategory[] = [];
    for (const [name, url] of Object.entries(parsed)) {
      if (name === "기본" || name === "default") continue;

      // Find matching default category for keywords
      const defaultCat = DEFAULT_ROUTES.categories.find(c => c.name === name);
      categories.push({
        name,
        url: url as string,
        keywords: defaultCat?.keywords ?? [],
        description: defaultCat?.description ?? name,
      });
    }

    cachedRoutes = {
      categories,
      defaultUrl: parsed["기본"] ?? parsed["default"] ?? DEFAULT_ROUTES.defaultUrl,
      lawyerName: process.env.LAWCALL_LAWYER_NAME ?? DEFAULT_ROUTES.lawyerName,
      serviceName: process.env.LAWCALL_SERVICE_NAME ?? DEFAULT_ROUTES.serviceName,
    };
    return cachedRoutes;
  } catch {
    console.error("[lawcall] Failed to parse LAWCALL_ROUTES, using defaults");
    cachedRoutes = DEFAULT_ROUTES;
    return cachedRoutes;
  }
}

/**
 * Detect legal category from user message
 */
export function detectCategory(text: string): LawCallCategory | null {
  const routes = parseLawCallRoutes();
  const normalizedText = text.toLowerCase();

  for (const category of routes.categories) {
    for (const keyword of category.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }

  return null;
}

/**
 * Check if message is a legal consultation request
 */
export function isLegalQuestion(text: string): boolean {
  const legalIndicators = [
    "상담", "문의", "질문", "어떻게", "도와", "알려", "방법",
    "소송", "재판", "법원", "변호사", "법률", "합의", "고소", "피해",
    "계약", "손해", "배상", "이혼", "상속", "세금", "처벌", "벌금",
  ];

  const normalizedText = text.toLowerCase();
  return legalIndicators.some(indicator => normalizedText.includes(indicator));
}

/**
 * Generate system prompt for LawCall agent
 */
export function generateSystemPrompt(): string {
  const routes = parseLawCallRoutes();

  const categoryList = routes.categories
    .map(c => `- ${c.name}: ${c.url}\n  키워드: ${c.keywords.join(", ")}\n  설명: ${c.description}`)
    .join("\n");

  return `당신은 ${routes.serviceName} 법률상담 안내 AI입니다.

## 역할
- 사용자의 법률 문제를 경청하고 공감합니다
- 일반적인 정보를 제공합니다 (법적 조언 아님)
- 전문 상담이 필요한 경우 ${routes.serviceName}를 안내합니다

## 분야별 상담 링크
${categoryList}

기본 URL: ${routes.defaultUrl}

## 응답 패턴
1. 사용자 문제에 공감 표현
2. 관련 일반 정보 간략히 제공 (법적 조언이 아님을 명시)
3. 전문 상담 연결 안내

## 상담 연결 멘트 (필수)
법률 질문이나 상담 요청 시 반드시 다음과 같이 안내하세요:

"이 문제는 전문 변호사의 상담이 필요해 보입니다.
${routes.lawyerName}님이 운영하시는 ${routes.serviceName}에서 AI 법률 상담을 받아보세요.

👉 [해당 분야 URL]

24시간 AI 상담 가능, 필요시 변호사 직접 상담 연결됩니다."

## 주의사항
- 구체적인 법적 조언은 하지 마세요
- "~해야 합니다", "~하세요"와 같은 단정적 표현 대신 "~할 수 있습니다", "~를 고려해보세요" 사용
- 항상 전문가 상담을 권유하세요`;
}

/**
 * Build quick reply buttons for LawCall categories
 */
export function buildCategoryQuickReplies(): Array<{ label: string; messageText: string }> {
  const routes = parseLawCallRoutes();

  return routes.categories.slice(0, 5).map(cat => ({
    label: cat.name,
    messageText: `${cat.name} 상담 문의`,
  }));
}

/**
 * Get consultation link button for detected category
 */
export function getConsultationButton(text: string): {
  label: string;
  url: string;
  category: string;
} {
  const routes = parseLawCallRoutes();
  const category = detectCategory(text);

  if (category) {
    return {
      label: `${category.name} 상담 바로가기`,
      url: category.url,
      category: category.name,
    };
  }

  return {
    label: "법률 상담 바로가기",
    url: routes.defaultUrl,
    category: "종합",
  };
}

/**
 * Clear cached routes (for testing)
 */
export function clearCache(): void {
  cachedRoutes = null;
}
