/**
 * 캘린더 Tool - Google Calendar + 카카오톡 캘린더 연동
 */

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  source: 'google' | 'kakao';
  calendarName?: string;
  attendees?: string[];
  reminders?: number[]; // 분 단위
}

export interface CalendarResult {
  events: CalendarEvent[];
  startDate: string;
  endDate: string;
  sources: ('google' | 'kakao')[];
}

// ==================== Google Calendar ====================

interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let googleTokensCache: GoogleCalendarTokens | null = null;

/**
 * Google OAuth 토큰 갱신
 */
async function refreshGoogleToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google Calendar 인증 정보가 설정되지 않았습니다');
  }

  // 캐시된 토큰이 유효한지 확인
  if (googleTokensCache && googleTokensCache.expiresAt > Date.now() + 60000) {
    return googleTokensCache.accessToken;
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`Google 토큰 갱신 실패: ${response.status}`);
  }

  const data = await response.json();

  googleTokensCache = {
    accessToken: data.access_token,
    refreshToken: refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return data.access_token;
}

/**
 * Google Calendar 이벤트 조회
 */
export async function getGoogleCalendarEvents(
  startDate?: string,
  endDate?: string,
): Promise<CalendarEvent[]> {
  // Google 인증 정보 확인
  if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('Google Calendar가 설정되지 않았습니다');
    return [];
  }

  try {
    const accessToken = await refreshGoogleToken();

    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const end = endDate
      ? new Date(endDate)
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 기본 7일

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', start.toISOString());
    url.searchParams.set('timeMax', end.toISOString());
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', '50');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Google Calendar API 오류: ${response.status}`);
    }

    const data = await response.json();

    return (data.items || []).map(
      (event: {
        id: string;
        summary?: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
        attendees?: { email: string }[];
        reminders?: { overrides?: { minutes: number }[] };
      }) => ({
        id: event.id,
        title: event.summary || '(제목 없음)',
        description: event.description,
        location: event.location,
        startTime: event.start.dateTime || event.start.date || '',
        endTime: event.end.dateTime || event.end.date || '',
        isAllDay: !event.start.dateTime,
        source: 'google' as const,
        calendarName: 'Google Calendar',
        attendees: event.attendees?.map((a) => a.email),
        reminders: event.reminders?.overrides?.map((r) => r.minutes),
      }),
    );
  } catch (error) {
    console.error('Google Calendar 조회 실패:', error);
    return [];
  }
}

// ==================== 카카오톡 캘린더 ====================

interface KakaoCalendarTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let kakaoTokensCache: Map<string, KakaoCalendarTokens> = new Map();

/**
 * 카카오 OAuth 토큰 갱신
 */
async function refreshKakaoToken(userId: string): Promise<string> {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;

  if (!clientId) {
    throw new Error('카카오 API 키가 설정되지 않았습니다');
  }

  // 캐시된 토큰 확인
  const cached = kakaoTokensCache.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.accessToken;
  }

  if (!cached?.refreshToken) {
    throw new Error('카카오 캘린더 접근 권한이 없습니다. 먼저 연동을 진행해주세요.');
  }

  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: cached.refreshToken,
  };

  if (clientSecret) {
    body.client_secret = clientSecret;
  }

  const response = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    throw new Error(`카카오 토큰 갱신 실패: ${response.status}`);
  }

  const data = await response.json();

  kakaoTokensCache.set(userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || cached.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  });

  return data.access_token;
}

/**
 * 카카오 캘린더 접근 권한 저장 (OAuth 콜백에서 호출)
 */
export function setKakaoCalendarToken(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): void {
  kakaoTokensCache.set(userId, {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });
}

/**
 * 카카오톡 캘린더 이벤트 조회
 */
export async function getKakaoCalendarEvents(
  startDate?: string,
  endDate?: string,
  userId?: string,
): Promise<CalendarEvent[]> {
  // 카카오 인증 정보 확인
  if (!process.env.KAKAO_REST_API_KEY) {
    console.warn('카카오 API가 설정되지 않았습니다');
    return [];
  }

  // 사용자별 토큰이 필요한 경우
  if (userId && !kakaoTokensCache.has(userId)) {
    // 토큰이 없으면 빈 배열 반환 (연동 안내 메시지는 별도 처리)
    return [];
  }

  try {
    const now = new Date();
    const start = startDate ? new Date(startDate) : now;
    const end = endDate
      ? new Date(endDate)
      : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // 카카오 톡캘린더 API 호출
    // 참고: 카카오 톡캘린더 API는 비공개 API이므로
    // 실제 구현 시 카카오 비즈니스 계약이 필요할 수 있음

    const accessToken = userId
      ? await refreshKakaoToken(userId)
      : process.env.KAKAO_ADMIN_ACCESS_TOKEN;

    if (!accessToken) {
      return [];
    }

    // 톡캘린더 일정 조회 (v2 API)
    const url = new URL('https://kapi.kakao.com/v2/api/calendar/events');
    url.searchParams.set('from', start.toISOString().slice(0, 10));
    url.searchParams.set('to', end.toISOString().slice(0, 10));

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      // 권한 없음 또는 미지원 API인 경우
      if (response.status === 403 || response.status === 404) {
        console.warn('카카오 톡캘린더 API 접근 불가');
        return [];
      }
      throw new Error(`카카오 캘린더 API 오류: ${response.status}`);
    }

    const data = await response.json();

    return (data.events || []).map(
      (event: {
        id: string;
        title?: string;
        description?: string;
        location?: { name?: string };
        time: {
          start_at: string;
          end_at: string;
          all_day?: boolean;
        };
        reminders?: { remind_at: number }[];
      }) => ({
        id: event.id,
        title: event.title || '(제목 없음)',
        description: event.description,
        location: event.location?.name,
        startTime: event.time.start_at,
        endTime: event.time.end_at,
        isAllDay: event.time.all_day || false,
        source: 'kakao' as const,
        calendarName: '톡캘린더',
        reminders: event.reminders?.map((r) => r.remind_at),
      }),
    );
  } catch (error) {
    console.error('카카오 캘린더 조회 실패:', error);
    return [];
  }
}

// ==================== 통합 캘린더 ====================

/**
 * 모든 캘린더 이벤트 통합 조회
 */
export async function getAllCalendarEvents(
  startDate?: string,
  endDate?: string,
  userId?: string,
): Promise<CalendarResult> {
  const now = new Date();
  const start = startDate || now.toISOString().slice(0, 10);
  const end =
    endDate || new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // 병렬로 조회
  const [googleEvents, kakaoEvents] = await Promise.all([
    getGoogleCalendarEvents(start, end),
    getKakaoCalendarEvents(start, end, userId),
  ]);

  // 시간순 정렬
  const allEvents = [...googleEvents, ...kakaoEvents].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  const sources: ('google' | 'kakao')[] = [];
  if (googleEvents.length > 0) sources.push('google');
  if (kakaoEvents.length > 0) sources.push('kakao');

  return {
    events: allEvents,
    startDate: start,
    endDate: end,
    sources,
  };
}

/**
 * 캘린더 결과를 자연어로 포맷팅
 */
export function formatCalendarMessage(result: CalendarResult): string {
  const { events, startDate, endDate, sources } = result;

  if (events.length === 0) {
    return `📅 ${startDate} ~ ${endDate} 기간에 등록된 일정이 없습니다.`;
  }

  let message = `📅 **일정 (${startDate} ~ ${endDate})**\n\n`;

  // 날짜별로 그룹핑
  const eventsByDate: Record<string, CalendarEvent[]> = {};
  for (const event of events) {
    const date = event.startTime.slice(0, 10);
    if (!eventsByDate[date]) {
      eventsByDate[date] = [];
    }
    eventsByDate[date].push(event);
  }

  for (const [date, dateEvents] of Object.entries(eventsByDate)) {
    const dayOfWeek = getDayOfWeek(date);
    message += `**${formatDate(date)} (${dayOfWeek})**\n`;

    for (const event of dateEvents) {
      const time = event.isAllDay ? '종일' : formatTime(event.startTime);
      const sourceIcon = event.source === 'google' ? '🔵' : '🟡';
      message += `${sourceIcon} ${time} - ${event.title}`;

      if (event.location) {
        message += ` 📍${event.location}`;
      }
      message += '\n';
    }
    message += '\n';
  }

  // 소스 범례
  if (sources.length > 1) {
    message += `_🔵 Google Calendar | 🟡 톡캘린더_`;
  }

  return message;
}

/**
 * 날짜 포맷팅 헬퍼
 */
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  return `${parseInt(month)}월 ${parseInt(day)}일`;
}

function formatTime(dateTimeStr: string): string {
  if (dateTimeStr.includes('T')) {
    const time = dateTimeStr.split('T')[1].slice(0, 5);
    const [hour, minute] = time.split(':');
    return `${hour}:${minute}`;
  }
  return '';
}

function getDayOfWeek(dateStr: string): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(dateStr);
  return days[date.getDay()];
}

/**
 * 카카오 캘린더 연동 안내 메시지
 */
export function getKakaoCalendarLinkMessage(): string {
  const clientId = process.env.KAKAO_REST_API_KEY;
  const redirectUri = process.env.KAKAO_CALENDAR_REDIRECT_URI ||
    `${process.env.LAWCALL_BASE_URL}/kakao/calendar/callback`;

  if (!clientId) {
    return '카카오 캘린더 연동이 지원되지 않습니다.';
  }

  const authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=talk_calendar`;

  return `📅 **톡캘린더 연동**\n\n카카오톡 캘린더와 연동하면 톡캘린더의 일정도 함께 조회할 수 있습니다.\n\n아래 링크를 클릭하여 연동을 진행해주세요:\n${authUrl}`;
}
