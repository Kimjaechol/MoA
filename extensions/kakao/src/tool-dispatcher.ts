/**
 * Tool Dispatcher - 의도에 따라 적절한 도구 호출
 */

import {
  classifyIntent,
  getSystemPromptForIntent,
  getResponseTemplate,
  type ClassifiedIntent,
} from './intent-classifier.js';
import { getWeather, formatWeatherMessage } from './tools/weather.js';
import {
  getAllCalendarEvents,
  formatCalendarMessage,
} from './tools/calendar.js';
import {
  getSportsSchedule,
  formatSportsMessage,
  parseSportsQuery,
} from './tools/sports.js';
import {
  getPublicHolidays,
  getAirQuality,
  formatHolidaysMessage,
  formatAirQualityMessage,
} from './tools/public-data.js';
import { aiSearch, formatSearchMessage, needsWebSearch } from './tools/search.js';
import {
  legalRAG,
  formatLegalRAGMessage,
  buildLegalContext,
  detectLegalCategory,
} from './rag/legal-rag.js';
import {
  generateImage,
  generateEmoticon,
  generateHeartImage,
  generateMusic,
  generateQRCode,
  formatCreativeMessage,
} from './tools/creative.js';
import {
  generateImage as freepikGenerateImage,
  searchResources as freepikSearchResources,
  formatGenerateMessage as formatFreepikGenerateMessage,
  formatSearchMessage as formatFreepikSearchMessage,
  detectFreepikRequest,
} from './tools/freepik.js';
import {
  translateText,
  searchTravelPhrases,
  getTravelPhrasesByCategory,
  formatTranslationMessage,
  formatTravelPhrases,
  formatTravelHelp,
  detectTranslationRequest,
} from './tools/realtime-translate.js';
import { formatLiveTranslateGuide } from './tools/gemini-live-translate.js';
import { getConsultationButton, parseLawCallRoutes } from './lawcall-router.js';

export interface ToolDispatchResult {
  handled: boolean;
  response?: string;
  imageUrl?: string;
  audioUrl?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  quickReplies?: string[];
  usedTool?: string;
  ragContext?: string; // LLM에 전달할 RAG 컨텍스트
  systemPrompt?: string; // 의도에 맞는 시스템 프롬프트
  intent: ClassifiedIntent;
}

/**
 * 메시지를 분석하고 적절한 도구 호출
 */
export async function dispatchTool(
  userId: string,
  message: string,
): Promise<ToolDispatchResult> {
  const intent = classifyIntent(message);

  // 기본 결과
  const result: ToolDispatchResult = {
    handled: false,
    intent,
    systemPrompt: getSystemPromptForIntent(intent),
  };

  try {
    switch (intent.type) {
      case 'weather':
        return await handleWeather(message, intent, result);

      case 'calendar':
        return await handleCalendar(userId, message, intent, result);

      case 'sports':
        return await handleSports(message, intent, result);

      case 'public_data':
        return await handlePublicData(message, intent, result);

      case 'web_search':
        return await handleWebSearch(message, intent, result);

      case 'legal_info':
        return await handleLegalInfo(message, intent, result);

      case 'legal_consult':
      case 'medical_consult':
      case 'tax_consult':
        return await handleExpertConsult(message, intent, result);

      case 'creative_image':
        return await handleCreativeImage(message, intent, result);

      case 'creative_emoticon':
        return await handleCreativeEmoticon(message, intent, result);

      case 'creative_music':
        return await handleCreativeMusic(message, intent, result);

      case 'creative_qrcode':
        return await handleCreativeQRCode(message, intent, result);

      case 'freepik_generate':
        return await handleFreepikGenerate(message, intent, result);

      case 'freepik_search':
        return await handleFreepikSearch(message, intent, result);

      case 'translate':
        return await handleTranslate(message, intent, result);

      case 'travel_help':
        return await handleTravelHelp(message, intent, result);

      case 'chat':
      default:
        // 일반 대화는 LLM에 위임
        // 단, 웹 검색이 필요한 경우 search 결과를 컨텍스트로 추가
        if (needsWebSearch(message)) {
          return await handleWebSearch(message, intent, result);
        }
        return result;
    }
  } catch (error) {
    console.error(`Tool dispatch error for ${intent.type}:`, error);
    return {
      ...result,
      handled: false,
    };
  }
}

// ==================== 도구별 핸들러 ====================

async function handleWeather(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  const location = intent.entities.location || extractLocation(message) || '서울';

  try {
    const weather = await getWeather(location);
    const response = formatWeatherMessage(weather);

    return {
      ...result,
      handled: true,
      response,
      usedTool: 'weather',
      quickReplies: ['미세먼지 알려줘', '내일 날씨는?', '우산 필요해?'],
    };
  } catch (error) {
    console.error('Weather fetch error:', error);
    return result; // LLM에 위임
  }
}

async function handleCalendar(
  userId: string,
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    // 날짜 범위 추출
    const { startDate, endDate } = extractDateRange(message);

    const calendarResult = await getAllCalendarEvents(startDate, endDate, userId);
    let response = formatCalendarMessage(calendarResult);

    // 톡캘린더 미연동 안내
    if (!calendarResult.sources.includes('kakao')) {
      response += '\n\n💡 톡캘린더를 연동하면 카카오톡 일정도 함께 볼 수 있어요!';
    }

    return {
      ...result,
      handled: true,
      response,
      usedTool: 'calendar',
      quickReplies: ['내일 일정은?', '이번 주 일정', '톡캘린더 연동'],
    };
  } catch (error) {
    console.error('Calendar fetch error:', error);
    return result;
  }
}

async function handleSports(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    const query = parseSportsQuery(message);
    const sportsResult = await getSportsSchedule(query);
    const response = formatSportsMessage(sportsResult);

    return {
      ...result,
      handled: true,
      response,
      usedTool: 'sports',
      quickReplies: ['내일 경기는?', 'KBO 순위', 'EPL 결과'],
    };
  } catch (error) {
    console.error('Sports fetch error:', error);
    return result;
  }
}

async function handlePublicData(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    // 공휴일 조회
    if (/공휴일|휴일|쉬는\s*날/.test(message)) {
      const year = extractYear(message);
      const month = extractMonth(message);
      const holidays = await getPublicHolidays(year, month);
      const response = formatHolidaysMessage(holidays, year);

      return {
        ...result,
        handled: true,
        response,
        usedTool: 'holidays',
        quickReplies: ['다음 공휴일은?', '연휴 언제야?'],
      };
    }

    // 대기질 조회
    if (/대기질|미세먼지|초미세먼지/.test(message)) {
      const location = extractLocation(message) || '서울';
      const airQuality = await getAirQuality(location);
      const response = formatAirQualityMessage(airQuality);

      return {
        ...result,
        handled: true,
        response,
        usedTool: 'air_quality',
        quickReplies: ['서울 대기질', '외출해도 돼?'],
      };
    }

    return result;
  } catch (error) {
    console.error('Public data fetch error:', error);
    return result;
  }
}

async function handleWebSearch(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    const searchResult = await aiSearch(message);
    const response = formatSearchMessage(searchResult);

    return {
      ...result,
      handled: true,
      response,
      usedTool: `search_${searchResult.provider}`,
      quickReplies: ['더 자세히', '관련 뉴스'],
    };
  } catch (error) {
    console.error('Web search error:', error);
    // 검색 실패 시 LLM에 위임
    return result;
  }
}

async function handleLegalInfo(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    const ragResult = await legalRAG(message);

    // 전문 상담이 필요한 경우
    if (ragResult.needsExpertConsultation && ragResult.recommendedCategory) {
      const consultButton = getConsultationButton(message);

      return {
        ...result,
        handled: true,
        response: formatLegalRAGMessage(ragResult),
        buttonLabel: consultButton.label,
        buttonUrl: consultButton.url,
        usedTool: 'legal_rag',
        quickReplies: ['전문 상담 신청', '더 알아보기'],
      };
    }

    // 일반 법률 정보: RAG 컨텍스트를 LLM에 전달
    const ragContext = buildLegalContext(ragResult.documents);

    return {
      ...result,
      handled: false, // LLM이 최종 응답 생성
      ragContext,
      usedTool: 'legal_rag',
    };
  } catch (error) {
    console.error('Legal RAG error:', error);
    return result;
  }
}

async function handleExpertConsult(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  const template = getResponseTemplate(intent);
  const routes = parseLawCallRoutes();

  let buttonLabel = '전문 상담 신청';
  let buttonUrl = intent.externalServiceUrl || routes['기본'];

  // 법률 상담인 경우 카테고리별 URL
  if (intent.type === 'legal_consult') {
    const category = detectLegalCategory(message);
    if (category !== '일반' && routes[category]) {
      buttonUrl = routes[category];
      buttonLabel = `${category} 상담 신청`;
    }
  }

  return {
    ...result,
    handled: true,
    response: template || '전문 상담이 필요한 문의입니다.',
    buttonLabel,
    buttonUrl,
    usedTool: `expert_${intent.type}`,
    quickReplies: ['상담 비용은?', '상담 절차는?'],
  };
}

async function handleCreativeImage(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    // 하트 이미지 특별 처리
    if (/하트|사랑|연인|애인/.test(message)) {
      const style =
        /귀여|cute/i.test(message) ? 'cute' : /우아|elegant/i.test(message) ? 'elegant' : 'romantic';

      const creative = await generateHeartImage(style as 'cute' | 'romantic' | 'elegant');

      return {
        ...result,
        handled: true,
        response: formatCreativeMessage(creative),
        imageUrl: creative.url,
        usedTool: 'image_generation',
        quickReplies: ['다른 스타일로', '더 귀엽게'],
      };
    }

    // 일반 이미지 생성
    const creative = await generateImage(message);

    return {
      ...result,
      handled: true,
      response: formatCreativeMessage(creative),
      imageUrl: creative.url,
      usedTool: 'image_generation',
      quickReplies: ['다시 생성', '스타일 변경'],
    };
  } catch (error) {
    console.error('Image generation error:', error);
    return {
      ...result,
      handled: true,
      response: '죄송합니다. 이미지 생성에 실패했습니다. 다시 시도해주세요.',
      quickReplies: ['다시 시도'],
    };
  }
}

async function handleCreativeEmoticon(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    // 감정 추출
    let emotion = 'happy';
    if (/슬프|울|sad/i.test(message)) { emotion = 'sad'; }
    else if (/화|angry/i.test(message)) { emotion = 'angry'; }
    else if (/사랑|love/i.test(message)) { emotion = 'love'; }
    else if (/놀|surprise/i.test(message)) { emotion = 'surprised'; }
    else if (/졸|sleepy/i.test(message)) { emotion = 'sleepy'; }

    const description = message.replace(/이모티콘|스티커|만들|생성|그려|줘/g, '').trim();
    const creative = await generateEmoticon(description || '귀여운 캐릭터', emotion);

    return {
      ...result,
      handled: true,
      response: formatCreativeMessage(creative),
      imageUrl: creative.url,
      usedTool: 'emoticon_generation',
      quickReplies: ['다른 표정으로', '더 귀엽게'],
    };
  } catch (error) {
    console.error('Emoticon generation error:', error);
    return {
      ...result,
      handled: true,
      response: '죄송합니다. 이모티콘 생성에 실패했습니다.',
      quickReplies: ['다시 시도'],
    };
  }
}

async function handleCreativeMusic(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    // 장르 추출
    let genre: string | undefined;
    if (/재즈|jazz/i.test(message)) { genre = 'jazz'; }
    else if (/클래식|classical/i.test(message)) { genre = 'classical'; }
    else if (/일렉|electronic/i.test(message)) { genre = 'electronic'; }
    else if (/로파이|lofi/i.test(message)) { genre = 'lofi'; }
    else if (/팝|pop/i.test(message)) { genre = 'pop'; }
    else if (/어쿠스틱|acoustic/i.test(message)) { genre = 'acoustic'; }
    else if (/잔잔|ambient/i.test(message)) { genre = 'ambient'; }

    const creative = await generateMusic(message, { genre, instrumental: true });

    return {
      ...result,
      handled: true,
      response: formatCreativeMessage(creative),
      audioUrl: creative.url,
      usedTool: 'music_generation',
      quickReplies: ['다른 장르로', '더 긴 버전'],
    };
  } catch (error) {
    console.error('Music generation error:', error);
    return {
      ...result,
      handled: true,
      response:
        '죄송합니다. 음악 생성에 실패했습니다. 음악 생성 API 키를 확인해주세요.',
      quickReplies: ['다시 시도'],
    };
  }
}

async function handleCreativeQRCode(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    // URL 또는 텍스트 추출
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
    const content = urlMatch ? urlMatch[1] : message.replace(/qr|큐알|코드|만들|생성|줘/gi, '').trim();

    if (!content) {
      return {
        ...result,
        handled: true,
        response: 'QR 코드로 만들 URL이나 텍스트를 입력해주세요.\n예: "https://lawcall.com QR 만들어줘"',
        quickReplies: ['예시 보기'],
      };
    }

    const creative = await generateQRCode(content);

    return {
      ...result,
      handled: true,
      response: `📱 QR 코드가 생성되었습니다!\n\n내용: ${content}\n\n${creative.url}`,
      imageUrl: creative.url,
      usedTool: 'qrcode_generation',
      quickReplies: ['다른 QR 만들기'],
    };
  } catch (error) {
    console.error('QR code generation error:', error);
    return {
      ...result,
      handled: true,
      response: 'QR 코드 생성에 실패했습니다.',
      quickReplies: ['다시 시도'],
    };
  }
}

// ==================== Freepik 핸들러 ====================

async function handleFreepikGenerate(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    const request = detectFreepikRequest(message);
    const generateResult = await freepikGenerateImage(request.prompt, {
      model: request.model,
      aspectRatio: request.aspectRatio,
    });
    const response = formatFreepikGenerateMessage(generateResult);

    return {
      ...result,
      handled: true,
      response,
      imageUrl: generateResult.images[0]?.url,
      usedTool: 'freepik_generate',
      quickReplies: ['다시 생성', '다른 모델로', '업스케일'],
    };
  } catch (error) {
    console.error('Freepik generate error:', error);
    return {
      ...result,
      handled: true,
      response: '죄송합니다. Freepik 이미지 생성에 실패했습니다.\nFREEPIK_API_KEY를 확인해주세요.',
      quickReplies: ['다시 시도', 'DALL-E로 생성'],
    };
  }
}

async function handleFreepikSearch(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  try {
    const request = detectFreepikRequest(message);
    const searchResult = await freepikSearchResources(request.prompt, { limit: 5 });
    const response = formatFreepikSearchMessage(searchResult);

    return {
      ...result,
      handled: true,
      response,
      usedTool: 'freepik_search',
      quickReplies: ['더 보기', '벡터만', '사진만'],
    };
  } catch (error) {
    console.error('Freepik search error:', error);
    return {
      ...result,
      handled: true,
      response: '죄송합니다. Freepik 검색에 실패했습니다.\nFREEPIK_API_KEY를 확인해주세요.',
      quickReplies: ['다시 시도'],
    };
  }
}

// ==================== 번역 / 여행 통역 핸들러 ====================

async function handleTranslate(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  const request = detectTranslationRequest(message);

  // Gemini Live 실시간 통역 요청
  if (request.type === 'live_translate') {
    return handleLiveTranslate(message, request, result);
  }

  // 텍스트 번역
  try {
    const translationResult = await translateText(request.text, {
      direction: request.direction,
    });
    const response = formatTranslationMessage(translationResult);

    return {
      ...result,
      handled: true,
      response,
      usedTool: 'translate',
      quickReplies: ['일본어로', '한국어로', '통역시작', '여행 표현'],
    };
  } catch (error) {
    console.error('Translation error:', error);
    return {
      ...result,
      handled: true,
      response:
        '죄송합니다. 번역에 실패했습니다.\n' +
        '번역 API 키를 확인해주세요:\n' +
        '• Papago: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET\n' +
        '• DeepL: DEEPL_API_KEY\n' +
        '• Google: GOOGLE_TRANSLATE_API_KEY',
      quickReplies: ['다시 시도'],
    };
  }
}

async function handleLiveTranslate(
  message: string,
  request: ReturnType<typeof detectTranslationRequest>,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  // 통역 종료 요청
  if (/^\/통역종료/.test(message)) {
    return {
      ...result,
      handled: true,
      response: [
        '🎙️ 실시간 통역 세션이 종료되었습니다.',
        '',
        '다시 시작하려면 /통역시작 을 입력하세요.',
      ].join('\n'),
      usedTool: 'live_translate',
      quickReplies: ['통역시작', '여행 표현', '번역'],
    };
  }

  // 통역 상태 요청
  if (/^\/통역상태/.test(message)) {
    return {
      ...result,
      handled: true,
      response: '🎙️ 현재 활성 통역 세션이 없습니다.\n/통역시작 으로 새 세션을 시작하세요.',
      usedTool: 'live_translate',
      quickReplies: ['통역시작', '전화통역'],
    };
  }

  // 통역 시작 — Gemini Live API 가이드 표시
  const hasGeminiKey = !!(process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY);

  if (!hasGeminiKey) {
    return {
      ...result,
      handled: true,
      response: [
        '🎙️ 실시간 통역을 사용하려면 Google API 키가 필요합니다.',
        '',
        'GOOGLE_API_KEY 또는 GEMINI_API_KEY를 설정해주세요.',
        'Google AI Studio에서 무료로 발급받을 수 있습니다:',
        'https://aistudio.google.com',
      ].join('\n'),
      quickReplies: ['텍스트 번역', '여행 표현'],
    };
  }

  // 모드 + 맥락 정보로 가이드 표시
  const modeLabel = request.direction === 'ja-ko' ? '🇯🇵→🇰🇷 일본어→한국어'
    : request.direction === 'ko-ja' ? '🇰🇷→🇯🇵 한국어→일본어'
    : '🔄 양방향 자동 감지';

  const contextLabel = request.liveContext ? `📋 맥락: ${request.liveContext}` : '';

  return {
    ...result,
    handled: true,
    response: formatLiveTranslateGuide() + '\n\n' + [
      '━━ 세션 설정 ━━',
      `🎯 모드: ${modeLabel}`,
      contextLabel,
      '',
      '🤖 Gemini 2.5 Flash Native Audio',
      '⚡ 음성→음성 직접 변환 (STT/TTS 파이프라인 없음)',
      '📱 MoA 모바일 앱에서 마이크 버튼으로 시작하세요.',
    ].filter(Boolean).join('\n'),
    usedTool: 'live_translate',
    quickReplies: ['통역종료', '통역상태', '여행 표현'],
  };
}

async function handleTravelHelp(
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  const request = detectTranslationRequest(message);

  // 특정 카테고리의 여행 표현 요청
  if (request.category) {
    const phrases = getTravelPhrasesByCategory(request.category);
    if (phrases.length > 0) {
      return {
        ...result,
        handled: true,
        response: formatTravelPhrases(phrases, request.category),
        usedTool: 'travel_phrases',
        quickReplies: ['식당 표현', '교통 표현', '긴급 표현', '쇼핑 표현'],
      };
    }

    // 카테고리 검색 폴백
    const searchResults = searchTravelPhrases(request.category);
    if (searchResults.length > 0) {
      return {
        ...result,
        handled: true,
        response: formatTravelPhrases(searchResults),
        usedTool: 'travel_phrases',
        quickReplies: ['식당 표현', '교통 표현', '긴급 표현'],
      };
    }
  }

  // 전체 여행 도우미 메뉴
  return {
    ...result,
    handled: true,
    response: formatTravelHelp(),
    usedTool: 'travel_help',
    quickReplies: ['식당 표현', '교통 표현', '긴급 표현', '번역 해줘'],
  };
}

// ==================== 헬퍼 함수 ====================

function extractLocation(message: string): string | null {
  const locations = [
    '서울',
    '부산',
    '대구',
    '인천',
    '광주',
    '대전',
    '울산',
    '세종',
    '제주',
    '경기',
    '강원',
    '충북',
    '충남',
    '전북',
    '전남',
    '경북',
    '경남',
    '수원',
    '용인',
    '고양',
    '성남',
    '청주',
    '천안',
    '전주',
    '포항',
    '창원',
  ];

  for (const loc of locations) {
    if (message.includes(loc)) {
      return loc;
    }
  }

  return null;
}

function extractDateRange(message: string): { startDate?: string; endDate?: string } {
  const today = new Date();

  if (/오늘/.test(message)) {
    const date = today.toISOString().slice(0, 10);
    return { startDate: date, endDate: date };
  }

  if (/내일/.test(message)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const date = tomorrow.toISOString().slice(0, 10);
    return { startDate: date, endDate: date };
  }

  if (/이번\s*주/.test(message)) {
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return {
      startDate: startOfWeek.toISOString().slice(0, 10),
      endDate: endOfWeek.toISOString().slice(0, 10),
    };
  }

  // 기본: 오늘부터 7일
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 7);
  return {
    startDate: today.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
}

function extractYear(message: string): number {
  const match = message.match(/(\d{4})년/);
  return match ? parseInt(match[1]) : new Date().getFullYear();
}

function extractMonth(message: string): number | undefined {
  const match = message.match(/(\d{1,2})월/);
  return match ? parseInt(match[1]) : undefined;
}
