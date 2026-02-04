/**
 * AI 검색 Tool - Perplexity AI & Google AI Search 연동
 *
 * 일반적인 질문에 대해 실시간 웹 검색 기반 AI 응답 제공
 */

export interface SearchResult {
  answer: string;
  sources: {
    title: string;
    url: string;
    snippet?: string;
  }[];
  provider: 'perplexity' | 'google' | 'fallback';
  query: string;
  timestamp: string;
}

// ==================== Perplexity AI ====================

interface PerplexityResponse {
  id: string;
  choices: {
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }[];
  citations?: string[];
}

/**
 * Perplexity AI 검색
 */
export async function searchWithPerplexity(
  query: string,
  options?: {
    model?: string;
    maxTokens?: number;
    systemPrompt?: string;
  },
): Promise<SearchResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  if (!apiKey) {
    throw new Error('Perplexity API 키가 설정되지 않았습니다 (PERPLEXITY_API_KEY)');
  }

  const model = options?.model || 'llama-3.1-sonar-large-128k-online';
  const maxTokens = options?.maxTokens || 1024;
  const systemPrompt =
    options?.systemPrompt ||
    `당신은 한국어로 응답하는 도움이 되는 AI 어시스턴트입니다.
질문에 대해 정확하고 최신 정보를 바탕으로 간결하게 답변하세요.
출처가 있는 경우 반드시 언급하세요.`;

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      return_citations: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Perplexity API 오류: ${response.status} - ${error}`);
  }

  const data: PerplexityResponse = await response.json();
  const answer = data.choices[0]?.message?.content || '';

  // 인용 URL 파싱
  const sources =
    data.citations?.map((url, index) => ({
      title: `출처 ${index + 1}`,
      url,
    })) || [];

  return {
    answer,
    sources,
    provider: 'perplexity',
    query,
    timestamp: new Date().toISOString(),
  };
}

// ==================== Google AI Search (Grounding) ====================

interface GoogleGroundingResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
    groundingMetadata?: {
      webSearchQueries?: string[];
      searchEntryPoint?: { renderedContent: string };
      groundingSupports?: {
        segment: { text: string };
        groundingChunkIndices: number[];
        confidenceScores: number[];
      }[];
      groundingChunks?: {
        web?: { uri: string; title: string };
      }[];
    };
  }[];
}

/**
 * Google AI Search (Gemini with Grounding)
 */
export async function searchWithGoogle(
  query: string,
  options?: {
    model?: string;
    systemPrompt?: string;
  },
): Promise<SearchResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;

  if (!apiKey) {
    throw new Error('Google AI API 키가 설정되지 않았습니다 (GOOGLE_AI_API_KEY)');
  }

  const model = options?.model || 'gemini-1.5-flash';
  const systemPrompt =
    options?.systemPrompt ||
    '한국어로 응답하세요. 최신 정보를 바탕으로 정확하게 답변하세요.';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: query }],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      tools: [
        {
          googleSearchRetrieval: {
            dynamicRetrievalConfig: {
              mode: 'MODE_DYNAMIC',
              dynamicThreshold: 0.3,
            },
          },
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google AI API 오류: ${response.status} - ${error}`);
  }

  const data: GoogleGroundingResponse = await response.json();
  const candidate = data.candidates[0];
  const answer = candidate?.content?.parts?.map((p) => p.text).join('') || '';

  // Grounding 출처 추출
  const sources =
    candidate?.groundingMetadata?.groundingChunks
      ?.filter((chunk) => chunk.web)
      .map((chunk) => ({
        title: chunk.web!.title,
        url: chunk.web!.uri,
      })) || [];

  return {
    answer,
    sources,
    provider: 'google',
    query,
    timestamp: new Date().toISOString(),
  };
}

// ==================== 통합 검색 ====================

/**
 * AI 검색 (Perplexity 우선, Google 백업)
 */
export async function aiSearch(
  query: string,
  options?: {
    provider?: 'perplexity' | 'google' | 'auto';
    systemPrompt?: string;
  },
): Promise<SearchResult> {
  const provider = options?.provider || 'auto';

  // 지정된 provider 사용
  if (provider === 'perplexity') {
    return searchWithPerplexity(query, options);
  }

  if (provider === 'google') {
    return searchWithGoogle(query, options);
  }

  // auto: Perplexity 우선, 실패 시 Google
  try {
    if (process.env.PERPLEXITY_API_KEY) {
      return await searchWithPerplexity(query, options);
    }
  } catch (error) {
    console.warn('Perplexity 검색 실패, Google로 대체:', error);
  }

  try {
    if (process.env.GOOGLE_AI_API_KEY) {
      return await searchWithGoogle(query, options);
    }
  } catch (error) {
    console.warn('Google 검색 실패:', error);
  }

  // 둘 다 실패한 경우
  return {
    answer: '죄송합니다. 현재 검색 서비스를 이용할 수 없습니다.',
    sources: [],
    provider: 'fallback',
    query,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 검색이 필요한 질문인지 판단
 */
export function needsWebSearch(query: string): boolean {
  const searchIndicators = [
    // 최신 정보 요청
    '최근',
    '최신',
    '오늘',
    '어제',
    '이번 주',
    '이번 달',
    '올해',
    '2024',
    '2025',
    '2026',
    // 뉴스/이슈
    '뉴스',
    '소식',
    '사건',
    '이슈',
    '논란',
    // 실시간 정보
    '현재',
    '지금',
    '실시간',
    '상황',
    // 가격/시세
    '가격',
    '시세',
    '환율',
    '주가',
    '코인',
    '비트코인',
    // 스포츠 결과
    '경기 결과',
    '승패',
    '우승',
    '순위',
    // 영화/공연
    '상영',
    '개봉',
    '공연',
    '티켓',
    // 맛집/장소
    '맛집',
    '추천',
    '어디',
    '위치',
    // 명시적 검색 요청
    '검색',
    '찾아',
    '알려',
    '알아봐',
  ];

  const lowerQuery = query.toLowerCase();
  return searchIndicators.some((indicator) => lowerQuery.includes(indicator));
}

/**
 * 검색 결과를 자연어로 포맷팅
 */
export function formatSearchMessage(result: SearchResult): string {
  let message = result.answer;

  if (result.sources.length > 0) {
    message += '\n\n📚 **출처**\n';
    for (const source of result.sources.slice(0, 5)) {
      message += `• [${source.title}](${source.url})\n`;
    }
  }

  return message;
}

/**
 * 특정 주제에 대한 검색
 */
export async function searchTopic(
  topic: string,
  category:
    | 'news'
    | 'weather'
    | 'sports'
    | 'entertainment'
    | 'tech'
    | 'finance'
    | 'general',
): Promise<SearchResult> {
  const systemPrompts: Record<string, string> = {
    news: `뉴스 전문가로서 최신 뉴스를 요약해서 전달하세요.
객관적인 사실 위주로 전달하고, 여러 관점이 있다면 균형있게 전달하세요.`,
    weather: `기상 정보 전문가로서 날씨 정보를 제공하세요.
오늘/내일/주간 날씨, 미세먼지, 자외선 등 실용적인 정보를 포함하세요.`,
    sports: `스포츠 전문가로서 경기 결과와 일정을 안내하세요.
점수, 순위, 주요 선수 활약상 등을 포함하세요.`,
    entertainment: `엔터테인먼트 전문가로서 연예/문화 소식을 전달하세요.
영화, 드라마, 음악, 공연 등의 최신 소식을 포함하세요.`,
    tech: `기술 전문가로서 IT/테크 소식을 전달하세요.
새로운 기술, 제품 출시, 기업 동향 등을 포함하세요.`,
    finance: `금융 전문가로서 경제/금융 정보를 제공하세요.
주가, 환율, 경제 지표 등의 최신 정보를 포함하세요.`,
    general: `한국어로 응답하는 도움이 되는 AI 어시스턴트입니다.
정확하고 최신 정보를 바탕으로 간결하게 답변하세요.`,
  };

  return aiSearch(topic, {
    systemPrompt: systemPrompts[category],
  });
}
