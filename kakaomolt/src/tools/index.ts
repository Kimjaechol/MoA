/**
 * Tool Registry - 모든 도구 통합 관리
 */

import { getWeather, type WeatherResult } from './weather.js';
import {
  getGoogleCalendarEvents,
  getKakaoCalendarEvents,
  getAllCalendarEvents,
  type CalendarEvent,
} from './calendar.js';
import { getSportsSchedule, type SportsResult } from './sports.js';
import {
  getPublicHolidays,
  getAirQuality,
  getCovidStats,
  type PublicDataResult,
} from './public-data.js';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  source: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'info' | 'action' | 'search';
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
    name: 'getWeather',
    description: '특정 지역의 현재 날씨와 예보를 조회합니다',
    category: 'info',
    parameters: [
      {
        name: 'location',
        type: 'string',
        required: true,
        description: '지역명 (예: 서울, 부산, 제주)',
      },
      {
        name: 'date',
        type: 'string',
        required: false,
        description: '조회할 날짜 (YYYY-MM-DD)',
      },
    ],
    execute: async (params) => {
      try {
        const result = await getWeather(
          params.location as string,
          params.date as string | undefined,
        );
        return { success: true, data: result, source: 'weather' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '날씨 조회 실패',
          source: 'weather',
        };
      }
    },
  },

  // Google 캘린더 조회
  getGoogleCalendar: {
    name: 'getGoogleCalendar',
    description: 'Google 캘린더에서 일정을 조회합니다',
    category: 'info',
    parameters: [
      {
        name: 'startDate',
        type: 'string',
        required: false,
        description: '시작 날짜 (YYYY-MM-DD)',
      },
      {
        name: 'endDate',
        type: 'string',
        required: false,
        description: '종료 날짜 (YYYY-MM-DD)',
      },
    ],
    execute: async (params) => {
      try {
        const result = await getGoogleCalendarEvents(
          params.startDate as string | undefined,
          params.endDate as string | undefined,
        );
        return { success: true, data: result, source: 'google_calendar' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '캘린더 조회 실패',
          source: 'google_calendar',
        };
      }
    },
  },

  // 카카오톡 캘린더 조회
  getKakaoCalendar: {
    name: 'getKakaoCalendar',
    description: '카카오톡 캘린더에서 일정을 조회합니다',
    category: 'info',
    parameters: [
      {
        name: 'startDate',
        type: 'string',
        required: false,
        description: '시작 날짜 (YYYY-MM-DD)',
      },
      {
        name: 'endDate',
        type: 'string',
        required: false,
        description: '종료 날짜 (YYYY-MM-DD)',
      },
    ],
    execute: async (params) => {
      try {
        const result = await getKakaoCalendarEvents(
          params.startDate as string | undefined,
          params.endDate as string | undefined,
        );
        return { success: true, data: result, source: 'kakao_calendar' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '톡캘린더 조회 실패',
          source: 'kakao_calendar',
        };
      }
    },
  },

  // 전체 캘린더 조회 (Google + Kakao)
  getAllCalendars: {
    name: 'getAllCalendars',
    description: 'Google 캘린더와 카카오톡 캘린더의 모든 일정을 조회합니다',
    category: 'info',
    parameters: [
      {
        name: 'startDate',
        type: 'string',
        required: false,
        description: '시작 날짜 (YYYY-MM-DD)',
      },
      {
        name: 'endDate',
        type: 'string',
        required: false,
        description: '종료 날짜 (YYYY-MM-DD)',
      },
    ],
    execute: async (params) => {
      try {
        const result = await getAllCalendarEvents(
          params.startDate as string | undefined,
          params.endDate as string | undefined,
        );
        return { success: true, data: result, source: 'all_calendars' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '캘린더 조회 실패',
          source: 'all_calendars',
        };
      }
    },
  },

  // 스포츠 일정 조회
  getSportsSchedule: {
    name: 'getSportsSchedule',
    description: '스포츠 경기 일정을 조회합니다 (KBO, K리그, NBA 등)',
    category: 'info',
    parameters: [
      {
        name: 'sport',
        type: 'string',
        required: true,
        description: '스포츠 종류 (baseball, soccer, basketball)',
      },
      {
        name: 'league',
        type: 'string',
        required: false,
        description: '리그 (KBO, K리그, NBA, EPL 등)',
      },
      {
        name: 'team',
        type: 'string',
        required: false,
        description: '팀명',
      },
      {
        name: 'date',
        type: 'string',
        required: false,
        description: '조회할 날짜 (YYYY-MM-DD)',
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
        return { success: true, data: result, source: 'sports' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '스포츠 일정 조회 실패',
          source: 'sports',
        };
      }
    },
  },

  // 공휴일 조회
  getHolidays: {
    name: 'getHolidays',
    description: '공휴일 정보를 조회합니다',
    category: 'info',
    parameters: [
      {
        name: 'year',
        type: 'number',
        required: false,
        description: '연도 (기본값: 현재 연도)',
      },
      {
        name: 'month',
        type: 'number',
        required: false,
        description: '월 (1-12)',
      },
    ],
    execute: async (params) => {
      try {
        const result = await getPublicHolidays(
          params.year as number | undefined,
          params.month as number | undefined,
        );
        return { success: true, data: result, source: 'public_holidays' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '공휴일 조회 실패',
          source: 'public_holidays',
        };
      }
    },
  },

  // 대기질 조회
  getAirQuality: {
    name: 'getAirQuality',
    description: '대기질 정보를 조회합니다 (미세먼지, 초미세먼지 등)',
    category: 'info',
    parameters: [
      {
        name: 'location',
        type: 'string',
        required: true,
        description: '지역명 (시/도 또는 시/군/구)',
      },
    ],
    execute: async (params) => {
      try {
        const result = await getAirQuality(params.location as string);
        return { success: true, data: result, source: 'air_quality' };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : '대기질 조회 실패',
          source: 'air_quality',
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
      source: 'tool_registry',
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
        .map((p) => `  - ${p.name} (${p.type}${p.required ? ', 필수' : ''}): ${p.description}`)
        .join('\n');
      return `### ${tool.name}\n${tool.description}\n파라미터:\n${params}`;
    })
    .join('\n\n');

  return `# 사용 가능한 도구\n\n${toolDescriptions}`;
}

export type { WeatherResult, CalendarEvent, SportsResult, PublicDataResult };
