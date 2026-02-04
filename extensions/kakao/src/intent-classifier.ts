/**
 * 의도 분류기 (Intent Classifier)
 *
 * 사용자 메시지를 분석하여 적절한 처리 방식 결정:
 * 1. 일반 대화 → LLM 직접 응답
 * 2. 정보 조회 (날씨, 일정 등) → Tool 호출
 * 3. 웹 검색 필요 → AI Search (Perplexity/Google)
 * 4. 법률 정보 조회 → Legal RAG
 * 5. 전문 상담 필요 → 외부 서비스 연결
 * 6. 창작 요청 → Creative AI
 */

export type IntentType =
  | 'chat' // 일반 대화
  | 'weather' // 날씨 조회
  | 'calendar' // 일정 조회
  | 'sports' // 스포츠 일정
  | 'public_data' // 공공 데이터 (공휴일, 대기질 등)
  | 'web_search' // 웹 검색
  | 'legal_info' // 법률 정보 (일반)
  | 'legal_consult' // 법률 상담 (전문)
  | 'medical_consult' // 의료 상담 (전문)
  | 'tax_consult' // 세무 상담 (전문)
  | 'creative_image' // 이미지 생성
  | 'creative_music' // 음악 생성
  | 'creative_emoticon' // 이모티콘 생성
  | 'creative_qrcode' // QR 코드 생성
  | 'billing'; // 과금 관련

export interface ClassifiedIntent {
  type: IntentType;
  confidence: number;
  entities: Record<string, string | undefined>;
  requiresExternalService: boolean;
  externalServiceUrl?: string;
  subType?: string;
}

// 패턴 기반 의도 분류
const INTENT_PATTERNS: {
  type: IntentType;
  patterns: RegExp[];
  priority: number;
  extractors?: {
    name: string;
    pattern: RegExp;
  }[];
}[] = [
  // 과금 관련 (최우선)
  {
    type: 'billing',
    patterns: [/^(잔액|크레딧|충전|요금|결제|결제내역|api\s*키)/i],
    priority: 100,
  },

  // 창작 요청
  {
    type: 'creative_image',
    patterns: [
      /그림.*(그려|만들|생성)/,
      /이미지.*(만들|생성|그려)/,
      /(만들|생성|그려).*(그림|이미지)/,
      /하트.*(이미지|그림|만들)/,
      /사진.*(만들|생성)/,
      /일러스트.*(그려|만들)/,
    ],
    priority: 90,
  },
  {
    type: 'creative_emoticon',
    patterns: [/이모티콘.*(만들|생성|그려)/, /스티커.*(만들|생성|그려)/, /캐릭터.*(만들|생성|그려)/],
    priority: 90,
  },
  {
    type: 'creative_music',
    patterns: [
      /음악.*(만들|생성|작곡)/,
      /노래.*(만들|생성|작곡)/,
      /bgm.*(만들|생성)/i,
      /배경음악.*(만들|생성)/,
      /멜로디.*(만들|생성)/,
    ],
    priority: 90,
  },
  {
    type: 'creative_qrcode',
    patterns: [/qr.*(만들|생성)/i, /큐알.*(만들|생성)/, /qr\s*코드/i],
    priority: 90,
  },

  // 날씨
  {
    type: 'weather',
    patterns: [/날씨/, /기온/, /비\s*(오|올|내릴)/, /눈\s*(오|올|내릴)/, /미세먼지/, /우산/],
    priority: 80,
    extractors: [
      { name: 'location', pattern: /(서울|부산|대구|인천|광주|대전|울산|제주|경기|강원)\s*/ },
      { name: 'date', pattern: /(오늘|내일|모레|이번\s*주)/ },
    ],
  },

  // 일정
  {
    type: 'calendar',
    patterns: [
      /일정/,
      /스케줄/,
      /캘린더/,
      /약속/,
      /(오늘|내일|이번\s*주).*(뭐|무슨|있)/,
      /톡캘린더/,
    ],
    priority: 80,
    extractors: [{ name: 'date', pattern: /(오늘|내일|모레|이번\s*주|\d{1,2}월\s*\d{1,2}일)/ }],
  },

  // 스포츠
  {
    type: 'sports',
    patterns: [
      /야구.*(경기|일정|결과)/,
      /축구.*(경기|일정|결과)/,
      /농구.*(경기|일정|결과)/,
      /(kbo|k리그|nba|epl)/i,
      /(두산|LG|삼성|키움|KT|SSG|롯데|한화|NC|KIA).*(경기|일정)/,
    ],
    priority: 80,
    extractors: [
      { name: 'sport', pattern: /(야구|축구|농구)/ },
      { name: 'league', pattern: /(kbo|k리그|nba|epl|프리미어)/i },
      {
        name: 'team',
        pattern: /(두산|LG|삼성|키움|KT|SSG|롯데|한화|NC|KIA|전북|울산|포항|서울)/,
      },
    ],
  },

  // 공공 데이터
  {
    type: 'public_data',
    patterns: [/공휴일/, /휴일/, /쉬는\s*날/, /대기질/, /미세먼지/, /초미세먼지/],
    priority: 75,
  },

  // 법률 상담 (전문) - 외부 서비스 연결
  {
    type: 'legal_consult',
    patterns: [
      /(변호사|법률\s*상담|법적\s*조언).*(필요|하고\s*싶|받고\s*싶)/,
      /(고소|피소|재판|소송).*(하려|해야|당했)/,
      /(급해|급합니다|시급|긴급).*(법률|법적)/,
      /어떻게\s*(해야|하면).*(법적|법률)/,
    ],
    priority: 70,
  },

  // 법률 정보 (일반) - RAG 처리
  {
    type: 'legal_info',
    patterns: [
      /법률|법령|조문|판례/,
      /무슨\s*법|어떤\s*법|어떤\s*조항/,
      /(손해배상|계약|이혼|상속|채무|채권).*(법|규정|조항)/,
    ],
    priority: 65,
  },

  // 의료 상담 (전문)
  {
    type: 'medical_consult',
    patterns: [
      /(병원|의사|진료|진단).*(가야|필요|하고\s*싶)/,
      /(아프|통증|증상).*(심각|심해|계속)/,
      /어떤\s*병|무슨\s*병|진단/,
    ],
    priority: 70,
  },

  // 세무 상담 (전문)
  {
    type: 'tax_consult',
    patterns: [
      /(세금|납세|세무).*(상담|조언|문의)/,
      /(절세|탈세|세무조사|과세).*(방법|어떻게)/,
      /(소득세|법인세|부가세|양도세|상속세|증여세).*(신고|계산|납부)/,
    ],
    priority: 70,
  },

  // 웹 검색 필요
  {
    type: 'web_search',
    patterns: [
      /최근|최신|요즘|오늘|어제/,
      /뉴스|소식|이슈/,
      /가격|시세|환율|주가/,
      /검색|찾아|알아봐/,
      /\d{4}년|\d{1,2}월/,
    ],
    priority: 50,
  },
];

// 전문 상담 외부 서비스 URL
const EXTERNAL_SERVICES: Record<string, { url: string; label: string }> = {
  legal_consult: {
    url: process.env.LAWCALL_DEFAULT_URL || 'https://lawcall.com',
    label: 'LawCall 법률 상담',
  },
  medical_consult: {
    url: 'https://www.hidoc.co.kr',
    label: '전문 의료 상담',
  },
  tax_consult: {
    url: 'https://www.nts.go.kr',
    label: '국세청 세무 상담',
  },
};

/**
 * 메시지 의도 분류
 */
export function classifyIntent(message: string): ClassifiedIntent {
  const normalizedMessage = message.trim().toLowerCase();

  // 패턴 매칭
  let bestMatch: ClassifiedIntent | null = null;
  let highestPriority = -1;

  for (const intentDef of INTENT_PATTERNS) {
    for (const pattern of intentDef.patterns) {
      if (pattern.test(message)) {
        if (intentDef.priority > highestPriority) {
          highestPriority = intentDef.priority;

          // 엔티티 추출
          const entities: Record<string, string | undefined> = {};
          if (intentDef.extractors) {
            for (const extractor of intentDef.extractors) {
              const match = message.match(extractor.pattern);
              if (match) {
                entities[extractor.name] = match[1];
              }
            }
          }

          // 외부 서비스 필요 여부
          const externalService = EXTERNAL_SERVICES[intentDef.type];

          bestMatch = {
            type: intentDef.type,
            confidence: 0.8 + intentDef.priority * 0.002,
            entities,
            requiresExternalService: !!externalService,
            externalServiceUrl: externalService?.url,
          };
        }
        break;
      }
    }
  }

  // 매칭되지 않으면 일반 대화
  if (!bestMatch) {
    return {
      type: 'chat',
      confidence: 0.5,
      entities: {},
      requiresExternalService: false,
    };
  }

  return bestMatch;
}

/**
 * 의도에 따른 시스템 프롬프트 생성
 */
export function getSystemPromptForIntent(intent: ClassifiedIntent): string {
  const basePrompt = `당신은 카카오톡에서 사용자를 돕는 친절한 AI 어시스턴트 "LawCall Bot"입니다.
한국어로 자연스럽게 대화하며, 정확하고 유용한 정보를 제공합니다.
답변은 간결하게 유지하되, 필요한 정보는 빠짐없이 전달하세요.`;

  const intentPrompts: Partial<Record<IntentType, string>> = {
    weather: `${basePrompt}
날씨 정보를 제공할 때는 기온, 강수 확률, 미세먼지 등 실용적인 정보를 포함하세요.
야외 활동 권장 여부나 우산 지참 필요성 등 행동 지침도 알려주세요.`,

    calendar: `${basePrompt}
일정 정보를 제공할 때는 시간, 장소, 참석자 등의 세부 정보를 명확히 전달하세요.
일정이 없는 경우 빈 시간대를 알려주고 새 일정 추가 방법을 안내하세요.`,

    sports: `${basePrompt}
스포츠 경기 정보를 제공할 때는 경기 시간, 대진, 장소, 중계 정보를 포함하세요.
팬이 관심 있을 만한 선수 정보나 이전 전적도 간략히 언급해주세요.`,

    legal_info: `${basePrompt}
법률 정보를 제공할 때는 관련 법령이나 판례를 인용하여 정확성을 높이세요.
복잡한 법률 용어는 쉽게 풀어 설명하고, 필요시 전문가 상담을 권유하세요.
⚠️ "이것은 법률 정보이며 법률 조언이 아닙니다"라는 면책 문구를 포함하세요.`,

    web_search: `${basePrompt}
최신 정보를 검색하여 답변할 때는 정보의 출처와 날짜를 명시하세요.
여러 출처가 있다면 균형 있게 정보를 전달하세요.`,

    creative_image: `${basePrompt}
이미지 생성 요청을 처리할 때는 사용자의 의도를 파악하여 최적의 프롬프트를 구성하세요.
생성된 이미지에 대한 간단한 설명과 수정 가능 여부를 안내하세요.`,

    creative_music: `${basePrompt}
음악 생성 요청을 처리할 때는 원하는 분위기, 장르, 용도를 확인하세요.
생성된 음악의 특징과 사용 방법을 안내하세요.`,
  };

  return intentPrompts[intent.type] || basePrompt;
}

/**
 * 의도에 따른 응답 템플릿 생성
 */
export function getResponseTemplate(intent: ClassifiedIntent): string | null {
  if (intent.requiresExternalService && intent.externalServiceUrl) {
    const serviceLabels: Record<IntentType, string> = {
      legal_consult: '⚖️ 전문 변호사 상담이 필요한 문의입니다.',
      medical_consult: '🏥 전문 의료 상담이 필요한 문의입니다.',
      tax_consult: '💰 전문 세무 상담이 필요한 문의입니다.',
    } as Record<IntentType, string>;

    const label = serviceLabels[intent.type];
    if (label) {
      return `${label}\n\n더 정확한 상담을 위해 전문 서비스를 이용해주세요.`;
    }
  }

  return null;
}

/**
 * 복합 의도 감지 (여러 의도가 섞여 있는 경우)
 */
export function detectMultipleIntents(message: string): ClassifiedIntent[] {
  const intents: ClassifiedIntent[] = [];
  const sentences = message.split(/[.?!]\s*/);

  for (const sentence of sentences) {
    if (sentence.trim()) {
      const intent = classifyIntent(sentence);
      if (intent.type !== 'chat') {
        intents.push(intent);
      }
    }
  }

  // 중복 제거
  const uniqueIntents = intents.filter(
    (intent, index, self) => index === self.findIndex((i) => i.type === intent.type),
  );

  return uniqueIntents.length > 0 ? uniqueIntents : [classifyIntent(message)];
}
