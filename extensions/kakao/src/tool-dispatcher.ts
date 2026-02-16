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
import {
  formatModeLabel,
  getLanguageQuickReplies,
  findLanguageByCode,
} from './tools/gemini-live-translate.js';
import {
  getSessionState,
  setAwaitingLanguage,
  setSessionActive,
  endSession,
  isAwaitingLanguage,
  parseLanguageResponse,
  isLiveTranslationIntent,
} from './tools/translation-session.js';
import { getConsultationButton, parseLawCallRoutes } from './lawcall-router.js';
import { selectSkill, formatSelectionDebug, type AutoSelectionResult } from './skill-auto-selector.js';
import {
  startRequestTracking,
  recordSkillUsage,
  recordLlmUsage,
  selfVerify,
  completeRequestTracking,
  formatUsageFooter,
  type RequestUsageSummary,
} from './usage-tracker.js';
import { formatCreditsCompact } from './pricing-table.js';

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
  /** Gemini Live 모드 시작 신호 — MoA 앱이 마이크를 활성화 */
  liveTranslateMode?: {
    enabled: boolean;
    targetLangCode: string;
    targetLangName: string;
    mode: string; // "bidirectional:en:ko" 등
    context?: string;
  };
  /** 스킬 자동 선택 결과 */
  skillSelection?: AutoSelectionResult;
  /** 요청별 사용량 추적 ID */
  trackingId?: string;
  /** 완료된 사용량 요약 (Replit 스타일 표시용) */
  usageSummary?: RequestUsageSummary;
}

/**
 * 메시지를 분석하고 적절한 도구 호출
 *
 * 스킬 자동 선택 우선순위:
 * 1. 무료 도구 (API Key 불필요) → 0 크레딧
 * 2. 무료 도구 (API Key 필요, 이용자 보유) → 0 크레딧
 * 3. 유료 도구 (저렴한 순 → 비싼 순) → 크레딧 차감
 */
export async function dispatchTool(
  userId: string,
  message: string,
): Promise<ToolDispatchResult> {
  const intent = classifyIntent(message);

  // ━━ 요청 추적 시작 ━━
  const trackingId = startRequestTracking(userId);

  // 스킬 자동 선택 수행
  const skillSelection = selectSkill(intent.type);
  console.log(formatSelectionDebug(skillSelection));

  // 기본 결과
  const result: ToolDispatchResult = {
    handled: false,
    intent,
    systemPrompt: getSystemPromptForIntent(intent),
    skillSelection,
    trackingId,
  };

  try {
    // ━━ 통역 대화 흐름: "언어 선택 대기 중" 체크 ━━
    if (isAwaitingLanguage(userId)) {
      const languageResult = handleLanguageSelection(userId, message, result);
      if (languageResult) return finalizeResult(languageResult, trackingId);
    }

    let handlerResult: ToolDispatchResult;

    switch (intent.type) {
      case 'weather':
        handlerResult = await handleWeather(message, intent, result);
        break;

      case 'calendar':
        handlerResult = await handleCalendar(userId, message, intent, result);
        break;

      case 'sports':
        handlerResult = await handleSports(message, intent, result);
        break;

      case 'public_data':
        handlerResult = await handlePublicData(message, intent, result);
        break;

      case 'web_search':
        handlerResult = await handleWebSearch(message, intent, result);
        break;

      case 'legal_info':
        handlerResult = await handleLegalInfo(message, intent, result);
        break;

      case 'legal_consult':
      case 'medical_consult':
      case 'tax_consult':
        handlerResult = await handleExpertConsult(message, intent, result);
        break;

      case 'creative_image':
        handlerResult = await handleCreativeImage(message, intent, result);
        break;

      case 'creative_emoticon':
        handlerResult = await handleCreativeEmoticon(message, intent, result);
        break;

      case 'creative_music':
        handlerResult = await handleCreativeMusic(message, intent, result);
        break;

      case 'creative_qrcode':
        handlerResult = await handleCreativeQRCode(message, intent, result);
        break;

      case 'freepik_generate':
        handlerResult = await handleFreepikGenerate(message, intent, result);
        break;

      case 'freepik_search':
        handlerResult = await handleFreepikSearch(message, intent, result);
        break;

      case 'translate':
        handlerResult = await handleTranslate(userId, message, intent, result);
        break;

      case 'travel_help':
        handlerResult = await handleTravelHelp(message, intent, result);
        break;

      case 'chat':
      default:
        // 일반 대화는 LLM에 위임
        if (needsWebSearch(message)) {
          handlerResult = await handleWebSearch(message, intent, result);
        } else {
          handlerResult = result;
        }
        break;
    }

    return finalizeResult(handlerResult, trackingId);
  } catch (error) {
    console.error(`Tool dispatch error for ${intent.type}:`, error);
    return finalizeResult({ ...result, handled: false }, trackingId);
  }
}

/**
 * Finalize result: 자기 검증 + 사용량 추적 완료 + Replit 스타일 크레딧 표시 추가
 */
function finalizeResult(
  result: ToolDispatchResult,
  trackingId: string,
): ToolDispatchResult {
  // 도구 사용 기록
  if (result.usedTool && result.handled) {
    const toolName = TOOL_DISPLAY_NAMES[result.usedTool] ?? result.usedTool;
    const creditsCost = TOOL_CREDIT_COSTS[result.usedTool] ?? 0;

    recordSkillUsage(trackingId, {
      toolId: result.usedTool,
      toolName,
      creditsUsed: creditsCost,
      usedOwnKey: isToolUsingOwnKey(result.usedTool),
      durationMs: 0, // Will be measured by webhook layer
      success: true,
    });
  }

  // 자기 검증 수행
  const verification = selfVerify(trackingId, result.response ?? null);

  // 사용량 추적 완료
  const usageSummary = completeRequestTracking(trackingId);

  // ━━ Replit 스타일: 응답 하단에 크레딧 소진량 작게 표시 ━━
  if (usageSummary && result.response && result.handled) {
    const footer = formatUsageFooter(usageSummary);
    if (footer) {
      result.response += footer;
    }
  }

  return {
    ...result,
    trackingId,
    usageSummary: usageSummary ?? undefined,
  };
}

// ============================================
// Tool Display Names & Credit Costs (intent → tool mapping)
// ============================================

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  weather: "기상청 날씨",
  calendar: "일정 조회",
  sports: "스포츠 일정",
  holidays: "공휴일 조회",
  air_quality: "대기질 조회",
  search_perplexity: "Perplexity 검색",
  search_google: "Google 검색",
  search_fallback: "웹 검색",
  search_serper: "Serper 검색",
  search_serper_shopping: "Serper 쇼핑 검색",
  search_serper_maps: "Serper 지도 검색",
  search_serper_lens: "Serper 이미지 분석",
  legal_rag: "법률 정보 검색",
  expert_legal_consult: "법률 상담",
  expert_medical_consult: "의료 상담",
  expert_tax_consult: "세무 상담",
  image_generation: "이미지 생성",
  emoticon_generation: "이모티콘 생성",
  music_generation: "음악 생성",
  qrcode_generation: "QR 코드 생성",
  freepik_generate: "Freepik AI 이미지",
  freepik_search: "Freepik 검색",
  translate: "번역",
  live_translate: "실시간 통역",
  travel_phrases: "여행 회화",
  travel_help: "여행 도우미",
};

const TOOL_CREDIT_COSTS: Record<string, number> = {
  weather: 0,
  calendar: 0,
  sports: 0,
  holidays: 0,
  air_quality: 0,
  legal_rag: 0,
  travel_phrases: 0,
  travel_help: 0,
  qrcode_generation: 0,
  freepik_generate: 0,  // freemium
  freepik_search: 0,     // freemium
  translate: 0,           // papago free tier
  search_serper: 1,       // Serper: search/news/images/videos/places/patents/reviews
  search_perplexity: 2,
  search_serper_shopping: 2, // Serper: shopping
  search_serper_maps: 3,     // Serper: maps
  search_serper_lens: 3,     // Serper: lens (image analysis)
  search_google: 7,
  search_fallback: 0,
  image_generation: 54,   // DALL-E 3 standard
  emoticon_generation: 54,
  music_generation: 68,   // Suno
  live_translate: 3,      // Gemini Live
};

/** Check if a tool is using the user's own API key (no credit charge) */
function isToolUsingOwnKey(toolId: string): boolean {
  const toolEnvMap: Record<string, string> = {
    search_serper: "SERPER_API_KEY",
    search_serper_shopping: "SERPER_API_KEY",
    search_serper_maps: "SERPER_API_KEY",
    search_serper_lens: "SERPER_API_KEY",
    search_perplexity: "PERPLEXITY_API_KEY",
    search_google: "GOOGLE_AI_API_KEY",
    image_generation: "OPENAI_API_KEY",
    emoticon_generation: "OPENAI_API_KEY",
    music_generation: "SUNO_API_KEY",
    live_translate: "GEMINI_API_KEY",
    freepik_generate: "FREEPIK_API_KEY",
    translate: "NAVER_CLIENT_ID",
  };

  const envVar = toolEnvMap[toolId];
  if (!envVar) return false;
  const value = process.env[envVar];
  return !!value && value.trim() !== "";
}

// ==================== 통역 대화 흐름 핸들러 ====================

/**
 * "어느 나라 말로 통역할까요?" 후 사용자의 언어 선택 응답 처리
 * 언어를 파싱할 수 있으면 세션 시작, 못하면 null 리턴 (폴스루)
 */
function handleLanguageSelection(
  userId: string,
  message: string,
  result: ToolDispatchResult,
): ToolDispatchResult | null {
  // 통역 종료/취소 의도
  if (/취소|그만|됐어|안\s*할래|괜찮아/.test(message)) {
    endSession(userId);
    return {
      ...result,
      handled: true,
      response: '통역을 취소했습니다. 필요하시면 언제든 "통역"이라고 말씀해주세요!',
      usedTool: 'live_translate',
    };
  }

  const language = parseLanguageResponse(message);
  if (!language) {
    // 언어를 인식하지 못한 경우 → 다시 물어봄
    return {
      ...result,
      handled: true,
      response: [
        '죄송해요, 어떤 언어인지 잘 모르겠어요.',
        '',
        '아래 버튼을 누르거나 언어 이름을 말씀해주세요.',
        '(예: "영어", "일본어", "중국어", "스페인어" 등)',
      ].join('\n'),
      usedTool: 'live_translate',
      quickReplies: getLanguageQuickReplies(),
    };
  }

  // 한국어를 선택한 경우 (자기 모국어)
  if (language.code === 'ko') {
    return {
      ...result,
      handled: true,
      response: [
        '한국어는 이미 사용 중이시네요! 😊',
        '통역할 상대방의 언어를 선택해주세요.',
      ].join('\n'),
      usedTool: 'live_translate',
      quickReplies: getLanguageQuickReplies(),
    };
  }

  // 언어 선택 완료 → 세션 활성화 + Live API 시작
  const session = getSessionState(userId);
  setSessionActive(userId, language, session.context);

  const mode = `bidirectional:${language.code}:ko`;

  return {
    ...result,
    handled: true,
    response: [
      `지금부터 요청하신 ${language.flag} ${language.nameKo}로 통역을 하겠습니다.`,
      '',
      `🎯 모드: ${formatModeLabel(mode)}`,
      '⚡ Gemini 2.5 Flash Native Audio (320~800ms)',
      '',
      '📱 마이크 버튼을 눌러 말씀하세요.',
      '통역을 끝내려면 "통역 종료"라고 말씀해주세요.',
    ].join('\n'),
    usedTool: 'live_translate',
    quickReplies: ['통역 종료', '통역 상태'],
    liveTranslateMode: {
      enabled: true,
      targetLangCode: language.code,
      targetLangName: language.nameKo,
      mode,
      context: session.context,
    },
  };
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
  userId: string,
  message: string,
  intent: ClassifiedIntent,
  result: ToolDispatchResult,
): Promise<ToolDispatchResult> {
  const request = detectTranslationRequest(message);

  // 통역 종료 요청
  if (/통역\s*(종료|끝|그만|멈춰|스탑|stop)/i.test(message) || /^\/통역종료/.test(message)) {
    endSession(userId);
    return {
      ...result,
      handled: true,
      response: [
        '🎙️ 통역을 종료했습니다.',
        '',
        '다시 필요하시면 "통역"이라고 말씀해주세요!',
      ].join('\n'),
      usedTool: 'live_translate',
      liveTranslateMode: { enabled: false, targetLangCode: '', targetLangName: '', mode: '' },
    };
  }

  // 통역 상태 요청
  if (/통역\s*상태/.test(message) || /^\/통역상태/.test(message)) {
    const session = getSessionState(userId);
    if (session.phase === 'active' && session.targetLanguage) {
      const lang = session.targetLanguage;
      return {
        ...result,
        handled: true,
        response: `🎙️ ${lang.flag} ${lang.nameKo} 통역 세션 활성 중\n"통역 종료"로 종료할 수 있습니다.`,
        usedTool: 'live_translate',
        quickReplies: ['통역 종료'],
      };
    }
    return {
      ...result,
      handled: true,
      response: '현재 활성 통역 세션이 없습니다.\n"통역"이라고 말하면 시작합니다.',
      usedTool: 'live_translate',
    };
  }

  // Gemini API 키 확인
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

  // ━━ 핵심 흐름: 라이브 통역 의도인지 텍스트 번역인지 판별 ━━
  const wantsLiveTranslation = isLiveTranslationIntent(message)
    || request.type === 'live_translate';

  if (wantsLiveTranslation) {
    // 언어가 이미 지정된 경우 → 바로 세션 시작
    if (request.targetLangCode) {
      const targetLang = findLanguageByCode(request.targetLangCode);
      if (targetLang && targetLang.code !== 'ko') {
        setSessionActive(userId, targetLang, request.liveContext);
        const mode = `bidirectional:${targetLang.code}:ko`;
        return {
          ...result,
          handled: true,
          response: [
            `지금부터 요청하신 ${targetLang.flag} ${targetLang.nameKo}로 통역을 하겠습니다.`,
            '',
            `🎯 모드: ${formatModeLabel(mode)}`,
            '⚡ Gemini 2.5 Flash Native Audio (320~800ms)',
            '',
            '📱 마이크 버튼을 눌러 말씀하세요.',
            '통역을 끝내려면 "통역 종료"라고 말씀해주세요.',
          ].join('\n'),
          usedTool: 'live_translate',
          quickReplies: ['통역 종료', '통역 상태'],
          liveTranslateMode: {
            enabled: true,
            targetLangCode: targetLang.code,
            targetLangName: targetLang.nameKo,
            mode,
            context: request.liveContext,
          },
        };
      }
    }

    // 언어가 지정되지 않은 경우 → "어느 나라 말로 통역할까요?" 질문
    setAwaitingLanguage(userId, request.liveContext);
    return {
      ...result,
      handled: true,
      response: '어느 나라 말로 통역할까요?',
      usedTool: 'live_translate',
      quickReplies: getLanguageQuickReplies(),
    };
  }

  // ━━ 텍스트 번역 (통역이 아닌 번역 요청) ━━
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
      quickReplies: ['일본어로', '한국어로', '통역', '여행 표현'],
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
