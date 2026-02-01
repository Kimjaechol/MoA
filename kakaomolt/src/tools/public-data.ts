/**
 * 공공데이터 API Tool
 *
 * - 공휴일 정보 (공공데이터포털)
 * - 대기질 정보 (에어코리아)
 * - 코로나19 현황 (공공데이터포털)
 */

export interface PublicDataResult {
  type: string;
  data: unknown;
  source: string;
  timestamp: string;
}

// ==================== 공휴일 정보 ====================

export interface Holiday {
  date: string;
  name: string;
  isHoliday: boolean;
}

/**
 * 공휴일 정보 조회 (공공데이터포털)
 */
export async function getPublicHolidays(
  year?: number,
  month?: number,
): Promise<Holiday[]> {
  const apiKey = process.env.DATA_GO_KR_API_KEY;

  const targetYear = year || new Date().getFullYear();
  const targetMonth = month;

  // API 키가 없으면 하드코딩된 주요 공휴일 반환
  if (!apiKey) {
    return getStaticHolidays(targetYear, targetMonth);
  }

  try {
    const url = new URL(
      'http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo',
    );
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('solYear', targetYear.toString());
    if (targetMonth) {
      url.searchParams.set('solMonth', targetMonth.toString().padStart(2, '0'));
    }
    url.searchParams.set('numOfRows', '100');
    url.searchParams.set('_type', 'json');

    const response = await fetch(url.toString());

    if (!response.ok) {
      console.warn('공휴일 API 오류, 정적 데이터 사용');
      return getStaticHolidays(targetYear, targetMonth);
    }

    const data = await response.json();
    const items = data.response?.body?.items?.item || [];

    // 단일 항목인 경우 배열로 변환
    const itemArray = Array.isArray(items) ? items : [items];

    return itemArray
      .filter((item: { isHoliday?: string }) => item.isHoliday === 'Y')
      .map((item: { locdate: number; dateName: string; isHoliday: string }) => ({
        date: item.locdate.toString().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
        name: item.dateName,
        isHoliday: item.isHoliday === 'Y',
      }));
  } catch (error) {
    console.error('공휴일 조회 실패:', error);
    return getStaticHolidays(targetYear, targetMonth);
  }
}

/**
 * 정적 공휴일 데이터 (API 실패 시 백업)
 */
function getStaticHolidays(year: number, month?: number): Holiday[] {
  const holidays: Holiday[] = [
    { date: `${year}-01-01`, name: '신정', isHoliday: true },
    { date: `${year}-03-01`, name: '삼일절', isHoliday: true },
    { date: `${year}-05-05`, name: '어린이날', isHoliday: true },
    { date: `${year}-06-06`, name: '현충일', isHoliday: true },
    { date: `${year}-08-15`, name: '광복절', isHoliday: true },
    { date: `${year}-10-03`, name: '개천절', isHoliday: true },
    { date: `${year}-10-09`, name: '한글날', isHoliday: true },
    { date: `${year}-12-25`, name: '크리스마스', isHoliday: true },
    // 음력 공휴일은 연도별로 다름 - 대략적인 날짜
    { date: `${year}-01-28`, name: '설날 전날', isHoliday: true },
    { date: `${year}-01-29`, name: '설날', isHoliday: true },
    { date: `${year}-01-30`, name: '설날 다음날', isHoliday: true },
    { date: `${year}-05-15`, name: '부처님오신날', isHoliday: true },
    { date: `${year}-09-16`, name: '추석 전날', isHoliday: true },
    { date: `${year}-09-17`, name: '추석', isHoliday: true },
    { date: `${year}-09-18`, name: '추석 다음날', isHoliday: true },
  ];

  if (month) {
    return holidays.filter((h) => parseInt(h.date.split('-')[1]) === month);
  }

  return holidays;
}

/**
 * 공휴일 메시지 포맷팅
 */
export function formatHolidaysMessage(holidays: Holiday[], year?: number): string {
  if (holidays.length === 0) {
    return '해당 기간에 공휴일이 없습니다.';
  }

  let message = `📅 **${year || new Date().getFullYear()}년 공휴일**\n\n`;

  const monthlyGroups: Record<string, Holiday[]> = {};
  for (const holiday of holidays) {
    const month = holiday.date.slice(0, 7);
    if (!monthlyGroups[month]) {
      monthlyGroups[month] = [];
    }
    monthlyGroups[month].push(holiday);
  }

  for (const [month, monthHolidays] of Object.entries(monthlyGroups)) {
    const monthName = parseInt(month.split('-')[1]);
    message += `**${monthName}월**\n`;
    for (const holiday of monthHolidays) {
      const day = parseInt(holiday.date.split('-')[2]);
      const dayOfWeek = getDayOfWeek(holiday.date);
      message += `• ${day}일 (${dayOfWeek}) - ${holiday.name}\n`;
    }
    message += '\n';
  }

  return message.trim();
}

// ==================== 대기질 정보 ====================

export interface AirQuality {
  location: string;
  pm10: number;
  pm25: number;
  o3: number;
  no2: number;
  co: number;
  so2: number;
  grade: string;
  gradeDescription: string;
  timestamp: string;
}

const AIR_QUALITY_GRADES: Record<number, { grade: string; description: string }> = {
  1: { grade: '좋음', description: '야외활동 적합' },
  2: { grade: '보통', description: '민감군 주의' },
  3: { grade: '나쁨', description: '야외활동 자제' },
  4: { grade: '매우나쁨', description: '외출 자제' },
};

// 시도별 측정소 코드
const SIDO_CODES: Record<string, string> = {
  서울: '서울',
  부산: '부산',
  대구: '대구',
  인천: '인천',
  광주: '광주',
  대전: '대전',
  울산: '울산',
  세종: '세종',
  경기: '경기',
  강원: '강원',
  충북: '충북',
  충남: '충남',
  전북: '전북',
  전남: '전남',
  경북: '경북',
  경남: '경남',
  제주: '제주',
};

/**
 * 대기질 정보 조회 (에어코리아)
 */
export async function getAirQuality(location: string): Promise<AirQuality> {
  const apiKey = process.env.DATA_GO_KR_API_KEY;

  if (!apiKey) {
    throw new Error('공공데이터 API 키가 설정되지 않았습니다 (DATA_GO_KR_API_KEY)');
  }

  // 시도명 추출
  let sidoName = '';
  for (const [key, value] of Object.entries(SIDO_CODES)) {
    if (location.includes(key)) {
      sidoName = value;
      break;
    }
  }

  if (!sidoName) {
    sidoName = '서울'; // 기본값
  }

  try {
    // 시도별 실시간 대기정보 조회
    const url = new URL(
      'http://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getCtprvnRltmMesureDnsty',
    );
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('sidoName', sidoName);
    url.searchParams.set('returnType', 'json');
    url.searchParams.set('numOfRows', '100');
    url.searchParams.set('ver', '1.0');

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`대기질 API 오류: ${response.status}`);
    }

    const data = await response.json();
    const items = data.response?.body?.items || [];

    // 해당 지역의 측정소 찾기
    const stationData = items.find(
      (item: { stationName: string }) =>
        location.includes(item.stationName) || item.stationName.includes(location),
    ) || items[0];

    if (!stationData) {
      throw new Error(`${location} 지역의 대기질 정보를 찾을 수 없습니다`);
    }

    const gradeInfo = AIR_QUALITY_GRADES[parseInt(stationData.khaiGrade) || 2];

    return {
      location: `${sidoName} ${stationData.stationName}`,
      pm10: parseFloat(stationData.pm10Value) || 0,
      pm25: parseFloat(stationData.pm25Value) || 0,
      o3: parseFloat(stationData.o3Value) || 0,
      no2: parseFloat(stationData.no2Value) || 0,
      co: parseFloat(stationData.coValue) || 0,
      so2: parseFloat(stationData.so2Value) || 0,
      grade: gradeInfo.grade,
      gradeDescription: gradeInfo.description,
      timestamp: stationData.dataTime,
    };
  } catch (error) {
    console.error('대기질 조회 실패:', error);
    throw error;
  }
}

/**
 * 대기질 메시지 포맷팅
 */
export function formatAirQualityMessage(airQuality: AirQuality): string {
  const gradeEmoji: Record<string, string> = {
    좋음: '🟢',
    보통: '🟡',
    나쁨: '🟠',
    매우나쁨: '🔴',
  };

  const emoji = gradeEmoji[airQuality.grade] || '⚪';

  let message = `🌬️ **${airQuality.location} 대기질**\n\n`;
  message += `${emoji} 종합: **${airQuality.grade}** (${airQuality.gradeDescription})\n\n`;
  message += `**세부 측정값**\n`;
  message += `• 미세먼지(PM10): ${airQuality.pm10} ㎍/㎥\n`;
  message += `• 초미세먼지(PM2.5): ${airQuality.pm25} ㎍/㎥\n`;
  message += `• 오존(O3): ${airQuality.o3} ppm\n`;
  message += `• 이산화질소(NO2): ${airQuality.no2} ppm\n`;
  message += `• 일산화탄소(CO): ${airQuality.co} ppm\n`;
  message += `• 아황산가스(SO2): ${airQuality.so2} ppm\n\n`;
  message += `_측정시간: ${airQuality.timestamp}_`;

  return message;
}

// ==================== 코로나19 현황 ====================

export interface CovidStats {
  date: string;
  confirmed: number;
  confirmedDaily: number;
  deaths: number;
  deathsDaily: number;
  recovered: number;
}

/**
 * 코로나19 현황 조회
 */
export async function getCovidStats(date?: string): Promise<CovidStats> {
  const apiKey = process.env.DATA_GO_KR_API_KEY;

  if (!apiKey) {
    throw new Error('공공데이터 API 키가 설정되지 않았습니다');
  }

  const targetDate = date || new Date().toISOString().slice(0, 10).replace(/-/g, '');

  try {
    const url = new URL(
      'http://openapi.data.go.kr/openapi/service/rest/Covid19/getCovid19InfStateJson',
    );
    url.searchParams.set('serviceKey', apiKey);
    url.searchParams.set('startCreateDt', targetDate);
    url.searchParams.set('endCreateDt', targetDate);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`코로나19 API 오류: ${response.status}`);
    }

    const data = await response.json();
    const item = data.response?.body?.items?.item;

    if (!item) {
      throw new Error('코로나19 데이터를 찾을 수 없습니다');
    }

    // 배열인 경우 첫 번째 항목 사용
    const stats = Array.isArray(item) ? item[0] : item;

    return {
      date: stats.stateDt?.toString() || targetDate,
      confirmed: stats.decideCnt || 0,
      confirmedDaily: stats.incDec || 0,
      deaths: stats.deathCnt || 0,
      deathsDaily: stats.deathIncDec || 0,
      recovered: stats.clearCnt || 0,
    };
  } catch (error) {
    console.error('코로나19 현황 조회 실패:', error);
    throw error;
  }
}

// ==================== 헬퍼 함수 ====================

function getDayOfWeek(dateStr: string): string {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(dateStr);
  return days[date.getDay()];
}
