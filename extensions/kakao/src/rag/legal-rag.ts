/**
 * 법률 RAG (Retrieval-Augmented Generation)
 *
 * - 국가법령정보센터 API (법령 검색)
 * - 대법원 판례 검색
 * - 법제처 행정규칙/조례
 *
 * 일반적인 법령/판례 정보는 AI가 직접 답변하고,
 * 전문적인 법률 상담은 LawCall로 연결
 */

export interface LegalDocument {
  id: string;
  type: 'law' | 'precedent' | 'regulation';
  title: string;
  content: string;
  source: string;
  url?: string;
  date?: string;
  relevanceScore?: number;
}

export interface LegalRAGResult {
  query: string;
  documents: LegalDocument[];
  summary?: string;
  needsExpertConsultation: boolean;
  recommendedCategory?: string;
  timestamp: string;
}

// ==================== 국가법령정보센터 API ====================

interface LawSearchResponse {
  LawSearch: {
    totalCnt: number;
    law: {
      법령ID: string;
      법령명한글: string;
      법령약칭명: string;
      시행일자: string;
      소관부처명: string;
      법령구분명: string;
    }[];
  };
}

interface LawDetailResponse {
  법령: {
    기본정보: {
      법령ID: string;
      법령명_한글: string;
      시행일자: string;
      제개정구분명: string;
    };
    조문: {
      조문단위: {
        조문번호: string;
        조문제목: string;
        조문내용: string;
      }[];
    };
  };
}

/**
 * 국가법령정보센터 법령 검색
 */
export async function searchLaws(query: string, limit: number = 10): Promise<LegalDocument[]> {
  const apiKey = process.env.LAW_API_KEY || process.env.DATA_GO_KR_API_KEY;

  if (!apiKey) {
    console.warn('법령 API 키가 설정되지 않았습니다');
    return [];
  }

  try {
    // 국가법령정보센터 Open API
    const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
    url.searchParams.set('OC', apiKey);
    url.searchParams.set('target', 'law');
    url.searchParams.set('type', 'JSON');
    url.searchParams.set('query', query);
    url.searchParams.set('display', limit.toString());

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`법령 검색 API 오류: ${response.status}`);
    }

    const data: LawSearchResponse = await response.json();
    const laws = data.LawSearch?.law || [];

    return laws.map((law) => ({
      id: law.법령ID,
      type: 'law' as const,
      title: law.법령명한글,
      content: `${law.법령명한글} (${law.법령약칭명 || ''})`,
      source: law.소관부처명,
      url: `https://www.law.go.kr/법령/${encodeURIComponent(law.법령명한글)}`,
      date: law.시행일자,
    }));
  } catch (error) {
    console.error('법령 검색 실패:', error);
    return [];
  }
}

/**
 * 법령 상세 조문 조회
 */
export async function getLawDetail(lawId: string): Promise<LegalDocument | null> {
  const apiKey = process.env.LAW_API_KEY || process.env.DATA_GO_KR_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const url = new URL('https://www.law.go.kr/DRF/lawService.do');
    url.searchParams.set('OC', apiKey);
    url.searchParams.set('target', 'law');
    url.searchParams.set('type', 'JSON');
    url.searchParams.set('ID', lawId);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`법령 상세 조회 API 오류: ${response.status}`);
    }

    const data: LawDetailResponse = await response.json();
    const lawInfo = data.법령?.기본정보;
    const articles = data.법령?.조문?.조문단위 || [];

    if (!lawInfo) {
      return null;
    }

    const content = articles
      .map((article) => `제${article.조문번호}조 (${article.조문제목})\n${article.조문내용}`)
      .join('\n\n');

    return {
      id: lawInfo.법령ID,
      type: 'law',
      title: lawInfo.법령명_한글,
      content,
      source: '국가법령정보센터',
      url: `https://www.law.go.kr/법령/${encodeURIComponent(lawInfo.법령명_한글)}`,
      date: lawInfo.시행일자,
    };
  } catch (error) {
    console.error('법령 상세 조회 실패:', error);
    return null;
  }
}

// ==================== 판례 검색 ====================

interface PrecedentSearchResponse {
  PrecSearch: {
    totalCnt: number;
    prec: {
      판례일련번호: string;
      사건명: string;
      사건번호: string;
      선고일자: string;
      법원명: string;
      사건종류명: string;
      판결유형: string;
      판시사항: string;
      판결요지: string;
    }[];
  };
}

/**
 * 대법원 판례 검색
 */
export async function searchPrecedents(
  query: string,
  limit: number = 10,
): Promise<LegalDocument[]> {
  const apiKey = process.env.LAW_API_KEY || process.env.DATA_GO_KR_API_KEY;

  if (!apiKey) {
    console.warn('법령 API 키가 설정되지 않았습니다');
    return [];
  }

  try {
    const url = new URL('https://www.law.go.kr/DRF/lawSearch.do');
    url.searchParams.set('OC', apiKey);
    url.searchParams.set('target', 'prec'); // 판례
    url.searchParams.set('type', 'JSON');
    url.searchParams.set('query', query);
    url.searchParams.set('display', limit.toString());

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`판례 검색 API 오류: ${response.status}`);
    }

    const data: PrecedentSearchResponse = await response.json();
    const precedents = data.PrecSearch?.prec || [];

    return precedents.map((prec) => ({
      id: prec.판례일련번호,
      type: 'precedent' as const,
      title: `${prec.사건명} (${prec.사건번호})`,
      content: `[판시사항]\n${prec.판시사항}\n\n[판결요지]\n${prec.판결요지}`,
      source: prec.법원명,
      url: `https://www.law.go.kr/판례/${prec.판례일련번호}`,
      date: prec.선고일자,
    }));
  } catch (error) {
    console.error('판례 검색 실패:', error);
    return [];
  }
}

// ==================== 법률 RAG 메인 ====================

/**
 * 법률 분야 감지
 */
export function detectLegalCategory(
  query: string,
): '민사' | '형사' | '이혼' | '세무' | '행정' | '헌법' | '일반' {
  const lowerQuery = query.toLowerCase();

  const categoryPatterns: [RegExp, '민사' | '형사' | '이혼' | '세무' | '행정' | '헌법'][] = [
    // 형사
    [
      /폭행|상해|살인|절도|사기|횡령|배임|명예훼손|모욕|협박|감금|체포|구속|기소|무죄|유죄|형벌|징역|벌금|집행유예|전과|수사|고소|고발/,
      '형사',
    ],
    // 이혼/가사
    [
      /이혼|양육권|친권|위자료|재산분할|별거|혼인|결혼|부부|가정폭력|가사|면접교섭|양육비/,
      '이혼',
    ],
    // 세무
    [
      /세금|납세|탈세|국세|지방세|소득세|법인세|부가가치세|상속세|증여세|양도세|취득세|재산세|세무조사|과세|공제|환급/,
      '세무',
    ],
    // 행정
    [
      /행정처분|허가|인가|등록|신고|과태료|영업정지|취소|행정소송|행정심판|공무원|민원|처분/,
      '행정',
    ],
    // 헌법
    [
      /헌법|기본권|위헌|헌법재판|헌법소원|권리침해|국가권력|헌법소원|위헌심판/,
      '헌법',
    ],
    // 민사 (기본)
    [
      /계약|손해배상|채무|채권|보증|임대차|전세|월세|부동산|매매|소유권|저당|담보|대출|금전|소송|민사|배상/,
      '민사',
    ],
  ];

  for (const [pattern, category] of categoryPatterns) {
    if (pattern.test(lowerQuery)) {
      return category;
    }
  }

  return '일반';
}

/**
 * 전문 상담이 필요한지 판단
 */
export function needsExpertConsultation(query: string, category: string): boolean {
  // 전문 상담이 필요한 키워드
  const expertKeywords = [
    // 긴급/심각
    '급해요',
    '급합니다',
    '긴급',
    '시급',
    '당장',
    '즉시',
    // 구체적 상황
    '제 경우',
    '저의 상황',
    '구체적',
    '어떻게 해야',
    '어떻게 하면',
    // 전문 상담 요청
    '변호사',
    '상담',
    '조언',
    '자문',
    '법률사무소',
    // 진행 중인 사건
    '재판',
    '소송',
    '고소',
    '피소',
    '합의',
    '조정',
    // 금액/피해 관련
    '얼마나',
    '손해',
    '피해',
    '보상',
    '배상금',
  ];

  const lowerQuery = query.toLowerCase();

  // 일반 법령 정보 질문이 아닌 경우 전문 상담 필요
  const infoKeywords = [
    '법령',
    '법률',
    '조문',
    '규정',
    '판례',
    '어떤 법',
    '무슨 법',
    '정의',
    '의미',
    '뜻',
  ];

  const isInfoQuery = infoKeywords.some((kw) => lowerQuery.includes(kw));

  if (isInfoQuery && category === '일반') {
    return false;
  }

  // 전문 상담 키워드 포함 시
  if (expertKeywords.some((kw) => lowerQuery.includes(kw))) {
    return true;
  }

  // 특정 분야는 전문 상담 권장
  if (['형사', '이혼', '세무', '헌법'].includes(category)) {
    return true;
  }

  return false;
}

/**
 * 법률 RAG 검색 및 답변 생성
 */
export async function legalRAG(query: string): Promise<LegalRAGResult> {
  const category = detectLegalCategory(query);
  const needsExpert = needsExpertConsultation(query, category);

  // 관련 법령 및 판례 검색
  const [laws, precedents] = await Promise.all([
    searchLaws(query, 5),
    searchPrecedents(query, 5),
  ]);

  const documents: LegalDocument[] = [...laws, ...precedents];

  // 관련도 점수 계산 (간단한 키워드 매칭)
  const queryWords = query.split(/\s+/).filter((w) => w.length > 1);
  for (const doc of documents) {
    let score = 0;
    for (const word of queryWords) {
      if (doc.title.includes(word)) score += 2;
      if (doc.content.includes(word)) score += 1;
    }
    doc.relevanceScore = score;
  }

  // 관련도 순 정렬
  documents.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

  return {
    query,
    documents: documents.slice(0, 5),
    needsExpertConsultation: needsExpert,
    recommendedCategory: category !== '일반' ? category : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 법률 RAG 결과를 자연어로 포맷팅
 */
export function formatLegalRAGMessage(result: LegalRAGResult): string {
  let message = '';

  if (result.documents.length > 0) {
    message += '📚 **관련 법령 및 판례**\n\n';

    for (const doc of result.documents.slice(0, 3)) {
      const typeLabel = doc.type === 'law' ? '📜' : '⚖️';
      message += `${typeLabel} **${doc.title}**\n`;

      if (doc.content.length > 200) {
        message += `${doc.content.slice(0, 200)}...\n`;
      } else {
        message += `${doc.content}\n`;
      }

      if (doc.url) {
        message += `🔗 [자세히 보기](${doc.url})\n`;
      }
      message += '\n';
    }
  } else {
    message += '관련 법령을 찾지 못했습니다.\n\n';
  }

  if (result.needsExpertConsultation) {
    message += '\n⚠️ **전문 상담 권장**\n';
    message += '이 문제는 전문 변호사의 상담이 필요할 수 있습니다.\n';

    if (result.recommendedCategory) {
      message += `분야: ${result.recommendedCategory} 전문\n`;
    }
  }

  return message;
}

/**
 * RAG 컨텍스트 생성 (LLM 프롬프트용)
 */
export function buildLegalContext(documents: LegalDocument[]): string {
  if (documents.length === 0) {
    return '';
  }

  let context = '참고 법령 및 판례:\n\n';

  for (const doc of documents) {
    const typeLabel = doc.type === 'law' ? '[법령]' : '[판례]';
    context += `${typeLabel} ${doc.title}\n`;
    context += `${doc.content.slice(0, 500)}\n`;
    if (doc.date) {
      context += `(${doc.date})\n`;
    }
    context += '\n---\n\n';
  }

  return context;
}
