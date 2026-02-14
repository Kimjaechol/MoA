/**
 * Tool Registry - 모든 도구 통합 관리
 */

import {
  getGoogleCalendarEvents,
  getKakaoCalendarEvents,
  getAllCalendarEvents,
  type CalendarEvent,
} from "./calendar.js";
import {
  generateImage as freepikGenerateImage,
  searchResources as freepikSearchResources,
  upscaleImage as freepikUpscaleImage,
  formatGenerateMessage as formatFreepikGenerateMessage,
  formatSearchMessage as formatFreepikSearchMessage,
  type FreepikGenerateResult,
  type FreepikSearchResult,
} from "./freepik.js";
import {
  getDirections,
  parseNavigationCommand,
  formatRouteResultForKakao,
  isNavigationQuery,
  type RouteResult,
  type TransportMode,
  type NavigationProvider,
} from "./navigation.js";
import { getPublicHolidays, getAirQuality, type PublicDataResult } from "./public-data.js";
import {
  translateText,
  searchTravelPhrases,
  getTravelPhrasesByCategory,
  formatTranslationMessage,
  formatTravelPhrases,
  formatTravelHelp,
  type TranslationResult,
  type TranslationDirection,
} from "./realtime-translate.js";
import { getSportsSchedule, type SportsResult } from "./sports.js";
import { getWeather, type WeatherResult } from "./weather.js";

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  source: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: "info" | "action" | "search";
  parameters: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * 사용 가능한 도구 목록
 */
export const tools: Record<string, ToolDefinition> = {
  // 날씨 조회
  getWeather: {
    name: "getWeather",
    description: "특정 지역의 현재 날씨와 예보를 조회합니다",
    category: "info",
    parameters: [
      {
        name: "location",
        type: "string",
        required: true,
        description: "지역명 (예: 서울, 부산, 제주)",
      },
      {
        name: "date",
        type: "string",
        required: false,
        description: "조회할 날짜 (YYYY-MM-DD)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getWeather(
          params.location as string,
          params.date as string | undefined,
        );
        return { success: true, data: result, source: "weather" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "날씨 조회 실패",
          source: "weather",
        };
      }
    },
  },

  // Google 캘린더 조회
  getGoogleCalendar: {
    name: "getGoogleCalendar",
    description: "Google 캘린더에서 일정을 조회합니다",
    category: "info",
    parameters: [
      {
        name: "startDate",
        type: "string",
        required: false,
        description: "시작 날짜 (YYYY-MM-DD)",
      },
      {
        name: "endDate",
        type: "string",
        required: false,
        description: "종료 날짜 (YYYY-MM-DD)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getGoogleCalendarEvents(
          params.startDate as string | undefined,
          params.endDate as string | undefined,
        );
        return { success: true, data: result, source: "google_calendar" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "캘린더 조회 실패",
          source: "google_calendar",
        };
      }
    },
  },

  // 카카오톡 캘린더 조회
  getKakaoCalendar: {
    name: "getKakaoCalendar",
    description: "카카오톡 캘린더에서 일정을 조회합니다",
    category: "info",
    parameters: [
      {
        name: "startDate",
        type: "string",
        required: false,
        description: "시작 날짜 (YYYY-MM-DD)",
      },
      {
        name: "endDate",
        type: "string",
        required: false,
        description: "종료 날짜 (YYYY-MM-DD)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getKakaoCalendarEvents(
          params.startDate as string | undefined,
          params.endDate as string | undefined,
        );
        return { success: true, data: result, source: "kakao_calendar" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "톡캘린더 조회 실패",
          source: "kakao_calendar",
        };
      }
    },
  },

  // 전체 캘린더 조회 (Google + Kakao)
  getAllCalendars: {
    name: "getAllCalendars",
    description: "Google 캘린더와 카카오톡 캘린더의 모든 일정을 조회합니다",
    category: "info",
    parameters: [
      {
        name: "startDate",
        type: "string",
        required: false,
        description: "시작 날짜 (YYYY-MM-DD)",
      },
      {
        name: "endDate",
        type: "string",
        required: false,
        description: "종료 날짜 (YYYY-MM-DD)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getAllCalendarEvents(
          params.startDate as string | undefined,
          params.endDate as string | undefined,
        );
        return { success: true, data: result, source: "all_calendars" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "캘린더 조회 실패",
          source: "all_calendars",
        };
      }
    },
  },

  // 스포츠 일정 조회
  getSportsSchedule: {
    name: "getSportsSchedule",
    description: "스포츠 경기 일정을 조회합니다 (KBO, K리그, NBA 등)",
    category: "info",
    parameters: [
      {
        name: "sport",
        type: "string",
        required: true,
        description: "스포츠 종류 (baseball, soccer, basketball)",
      },
      {
        name: "league",
        type: "string",
        required: false,
        description: "리그 (KBO, K리그, NBA, EPL 등)",
      },
      {
        name: "team",
        type: "string",
        required: false,
        description: "팀명",
      },
      {
        name: "date",
        type: "string",
        required: false,
        description: "조회할 날짜 (YYYY-MM-DD)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getSportsSchedule({
          sport: params.sport as string,
          league: params.league as string | undefined,
          team: params.team as string | undefined,
          date: params.date as string | undefined,
        });
        return { success: true, data: result, source: "sports" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "스포츠 일정 조회 실패",
          source: "sports",
        };
      }
    },
  },

  // 공휴일 조회
  getHolidays: {
    name: "getHolidays",
    description: "공휴일 정보를 조회합니다",
    category: "info",
    parameters: [
      {
        name: "year",
        type: "number",
        required: false,
        description: "연도 (기본값: 현재 연도)",
      },
      {
        name: "month",
        type: "number",
        required: false,
        description: "월 (1-12)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getPublicHolidays(
          params.year as number | undefined,
          params.month as number | undefined,
        );
        return { success: true, data: result, source: "public_holidays" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "공휴일 조회 실패",
          source: "public_holidays",
        };
      }
    },
  },

  // 대기질 조회
  getAirQuality: {
    name: "getAirQuality",
    description: "대기질 정보를 조회합니다 (미세먼지, 초미세먼지 등)",
    category: "info",
    parameters: [
      {
        name: "location",
        type: "string",
        required: true,
        description: "지역명 (시/도 또는 시/군/구)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getAirQuality(params.location as string);
        return { success: true, data: result, source: "air_quality" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "대기질 조회 실패",
          source: "air_quality",
        };
      }
    },
  },

  // 길찾기 / 내비게이션
  getDirections: {
    name: "getDirections",
    description:
      "출발지에서 도착지까지의 경로, 소요 시간, 거리를 조회합니다. 자동차, 대중교통, 도보, 자전거 경로를 지원합니다.",
    category: "info",
    parameters: [
      {
        name: "origin",
        type: "string",
        required: true,
        description: "출발지 (주소 또는 장소명, 예: 서울역, 강남역)",
      },
      {
        name: "destination",
        type: "string",
        required: true,
        description: "도착지 (주소 또는 장소명, 예: 인천공항, 코엑스)",
      },
      {
        name: "mode",
        type: "string",
        required: false,
        description:
          "이동 수단: driving(자동차), transit(대중교통), walking(도보), cycling(자전거). 기본값: driving",
      },
      {
        name: "provider",
        type: "string",
        required: false,
        description: "지도 제공자: kakao, naver, google, auto(자동 선택). 기본값: auto",
      },
    ],
    execute: async (params) => {
      try {
        const result = await getDirections(params.origin as string, params.destination as string, {
          mode: params.mode as TransportMode | undefined,
          provider: params.provider as NavigationProvider | undefined,
        });
        return {
          success: result.success,
          data: {
            ...result,
            formattedMessage: formatRouteResultForKakao(result),
          },
          source: "navigation",
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "경로 조회 실패",
          source: "navigation",
        };
      }
    },
  },

  // Freepik AI 이미지 생성
  freepikGenerate: {
    name: "freepikGenerate",
    description: "Freepik AI로 고품질 이미지를 생성합니다 (Mystic, HyperFlux, Classic 모델)",
    category: "action",
    parameters: [
      {
        name: "prompt",
        type: "string",
        required: true,
        description: "이미지 설명 프롬프트",
      },
      {
        name: "model",
        type: "string",
        required: false,
        description: "모델 선택: mystic(최고품질), hyperflux(빠른), classic(경제적)",
      },
      {
        name: "aspectRatio",
        type: "string",
        required: false,
        description: "비율: square, landscape, portrait, widescreen",
      },
    ],
    execute: async (params) => {
      try {
        const result = await freepikGenerateImage(params.prompt as string, {
          model: params.model as "mystic" | "hyperflux" | "classic" | undefined,
          aspectRatio: params.aspectRatio as "square" | "landscape" | "portrait" | "widescreen" | undefined,
        });
        return { success: true, data: result, source: "freepik" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Freepik 이미지 생성 실패",
          source: "freepik",
        };
      }
    },
  },

  // Freepik 스톡 리소스 검색
  freepikSearch: {
    name: "freepikSearch",
    description: "Freepik에서 디자인 리소스를 검색합니다 (사진, 벡터, PSD, AI 이미지)",
    category: "search",
    parameters: [
      {
        name: "query",
        type: "string",
        required: true,
        description: "검색어 (예: modern logo, 한국 음식)",
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        description: "유형: photo, vector, psd, ai_generated",
      },
      {
        name: "limit",
        type: "number",
        required: false,
        description: "결과 수 (1-20, 기본값: 5)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await freepikSearchResources(params.query as string, {
          contentType: params.contentType as "photo" | "vector" | "psd" | "ai_generated" | undefined,
          limit: params.limit as number | undefined,
        });
        return { success: true, data: result, source: "freepik_search" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Freepik 검색 실패",
          source: "freepik_search",
        };
      }
    },
  },

  // 실시간 번역
  translate: {
    name: "translate",
    description: "실시간 텍스트 번역 (일본어↔한국어 특화, Papago/DeepL/Google 자동 선택)",
    category: "action",
    parameters: [
      {
        name: "text",
        type: "string",
        required: true,
        description: "번역할 텍스트",
      },
      {
        name: "direction",
        type: "string",
        required: false,
        description: "번역 방향: ja-ko, ko-ja, en-ko, ko-en 등 (자동 감지 가능)",
      },
    ],
    execute: async (params) => {
      try {
        const result = await translateText(params.text as string, {
          direction: params.direction as TranslationDirection | undefined,
        });
        return { success: true, data: result, source: "translate" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "번역 실패",
          source: "translate",
        };
      }
    },
  },
};

/**
 * 도구 실행
 */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = tools[toolName];
  if (!tool) {
    return {
      success: false,
      error: `알 수 없는 도구: ${toolName}`,
      source: "tool_registry",
    };
  }

  // 필수 파라미터 검증
  for (const param of tool.parameters) {
    if (param.required && !(param.name in params)) {
      return {
        success: false,
        error: `필수 파라미터 누락: ${param.name}`,
        source: tool.name,
      };
    }
  }

  return tool.execute(params);
}

/**
 * 도구 목록을 LLM 프롬프트용으로 포맷팅
 */
export function getToolsPrompt(): string {
  const toolDescriptions = Object.values(tools)
    .map((tool) => {
      const params = tool.parameters
        .map((p) => `  - ${p.name} (${p.type}${p.required ? ", 필수" : ""}): ${p.description}`)
        .join("\n");
      return `### ${tool.name}\n${tool.description}\n파라미터:\n${params}`;
    })
    .join("\n\n");

  return `# 사용 가능한 도구\n\n${toolDescriptions}`;
}

export type { WeatherResult, CalendarEvent, SportsResult, PublicDataResult };

// Navigation exports
export {
  getDirections,
  parseNavigationCommand,
  formatRouteResultForKakao,
  isNavigationQuery,
} from "./navigation.js";
export type { RouteResult, TransportMode, NavigationProvider } from "./navigation.js";

// Freepik exports
export {
  freepikGenerateImage,
  freepikSearchResources,
  freepikUpscaleImage,
  formatFreepikGenerateMessage,
  formatFreepikSearchMessage,
} from "./freepik.js";
export type { FreepikGenerateResult, FreepikSearchResult } from "./freepik.js";

// Translation exports
export {
  translateText,
  searchTravelPhrases,
  getTravelPhrasesByCategory,
  formatTranslationMessage,
  formatTravelPhrases,
  formatTravelHelp,
} from "./realtime-translate.js";
export type { TranslationResult, TranslationDirection } from "./realtime-translate.js";

// Gemini Live multi-language exports
export {
  SUPPORTED_LANGUAGES,
  findLanguageByKeyword,
  findLanguageByCode,
  formatModeLabel,
  getLanguageQuickReplies,
  formatLiveTranslateGuide,
  formatSessionStatus,
  GeminiLiveTranslator,
} from "./gemini-live-translate.js";
export type { LanguageInfo, LiveSessionConfig } from "./gemini-live-translate.js";

// Translation session state management
export {
  getSessionState,
  setAwaitingLanguage,
  setSessionActive,
  endSession,
  isAwaitingLanguage,
  parseLanguageResponse,
  isTranslationIntent,
  isLiveTranslationIntent,
} from "./translation-session.js";
export type { SessionPhase, TranslationSessionState } from "./translation-session.js";
