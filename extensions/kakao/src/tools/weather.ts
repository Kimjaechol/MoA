/**
 * 날씨 조회 Tool - 기상청 API 연동
 *
 * 기상청 단기예보 API 및 OpenWeatherMap API 지원
 */

export interface WeatherResult {
  location: string;
  date: string;
  current: {
    temperature: number;
    humidity: number;
    sky: string; // 맑음, 구름많음, 흐림
    precipitation: string; // 없음, 비, 비/눈, 눈
    windSpeed: number;
    windDirection: string;
  };
  forecast: {
    time: string;
    temperature: number;
    sky: string;
    precipitation: string;
    precipitationProbability: number;
  }[];
  alerts?: string[];
}

// 기상청 격자 좌표 (주요 도시)
const CITY_COORDINATES: Record<string, { nx: number; ny: number }> = {
  서울: { nx: 60, ny: 127 },
  부산: { nx: 98, ny: 76 },
  대구: { nx: 89, ny: 90 },
  인천: { nx: 55, ny: 124 },
  광주: { nx: 58, ny: 74 },
  대전: { nx: 67, ny: 100 },
  울산: { nx: 102, ny: 84 },
  세종: { nx: 66, ny: 103 },
  경기: { nx: 60, ny: 120 },
  강원: { nx: 73, ny: 134 },
  충북: { nx: 69, ny: 107 },
  충남: { nx: 68, ny: 100 },
  전북: { nx: 63, ny: 89 },
  전남: { nx: 51, ny: 67 },
  경북: { nx: 89, ny: 91 },
  경남: { nx: 91, ny: 77 },
  제주: { nx: 52, ny: 38 },
  수원: { nx: 60, ny: 121 },
  용인: { nx: 62, ny: 120 },
  고양: { nx: 57, ny: 128 },
  성남: { nx: 63, ny: 124 },
  청주: { nx: 69, ny: 106 },
  천안: { nx: 63, ny: 110 },
  전주: { nx: 63, ny: 89 },
  포항: { nx: 102, ny: 94 },
  창원: { nx: 90, ny: 77 },
};

// 하늘 상태 코드
const SKY_CODES: Record<string, string> = {
  '1': '맑음',
  '3': '구름많음',
  '4': '흐림',
};

// 강수 형태 코드
const PTY_CODES: Record<string, string> = {
  '0': '없음',
  '1': '비',
  '2': '비/눈',
  '3': '눈',
  '4': '소나기',
  '5': '빗방울',
  '6': '빗방울눈날림',
  '7': '눈날림',
};

/**
 * 기상청 단기예보 API 호출
 */
async function fetchKMAWeather(
  nx: number,
  ny: number,
  baseDate: string,
  baseTime: string,
): Promise<Record<string, string>[]> {
  const serviceKey = process.env.KMA_API_KEY || process.env.DATA_GO_KR_API_KEY;

  if (!serviceKey) {
    throw new Error('기상청 API 키가 설정되지 않았습니다 (KMA_API_KEY)');
  }

  const url = new URL('http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst');
  url.searchParams.set('serviceKey', serviceKey);
  url.searchParams.set('pageNo', '1');
  url.searchParams.set('numOfRows', '1000');
  url.searchParams.set('dataType', 'JSON');
  url.searchParams.set('base_date', baseDate);
  url.searchParams.set('base_time', baseTime);
  url.searchParams.set('nx', nx.toString());
  url.searchParams.set('ny', ny.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`기상청 API 오류: ${response.status}`);
  }

  const data = await response.json();

  if (data.response?.header?.resultCode !== '00') {
    throw new Error(`기상청 API 오류: ${data.response?.header?.resultMsg || '알 수 없는 오류'}`);
  }

  return data.response?.body?.items?.item || [];
}

/**
 * OpenWeatherMap API 호출 (백업)
 */
async function fetchOpenWeather(location: string): Promise<WeatherResult> {
  const apiKey = process.env.OPENWEATHER_API_KEY;

  if (!apiKey) {
    throw new Error('OpenWeatherMap API 키가 설정되지 않았습니다');
  }

  // Geocoding
  const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)},KR&limit=1&appid=${apiKey}`;
  const geoResponse = await fetch(geoUrl);
  const geoData = await geoResponse.json();

  if (!geoData.length) {
    throw new Error(`위치를 찾을 수 없습니다: ${location}`);
  }

  const { lat, lon } = geoData[0];

  // Weather data
  const weatherUrl = `http://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=kr`;
  const weatherResponse = await fetch(weatherUrl);
  const weatherData = await weatherResponse.json();

  const current = weatherData.list[0];
  const forecast = weatherData.list.slice(0, 8).map(
    (item: {
      dt_txt: string;
      main: { temp: number };
      weather: { main: string }[];
      pop: number;
    }) => ({
      time: item.dt_txt,
      temperature: Math.round(item.main.temp),
      sky: item.weather[0].main,
      precipitation: item.weather[0].main === 'Rain' ? '비' : '없음',
      precipitationProbability: Math.round((item.pop || 0) * 100),
    }),
  );

  return {
    location,
    date: new Date().toISOString().split('T')[0],
    current: {
      temperature: Math.round(current.main.temp),
      humidity: current.main.humidity,
      sky: current.weather[0].description,
      precipitation: current.weather[0].main === 'Rain' ? '비' : '없음',
      windSpeed: current.wind.speed,
      windDirection: getWindDirection(current.wind.deg),
    },
    forecast,
  };
}

/**
 * 풍향 계산
 */
function getWindDirection(deg: number): string {
  const directions = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
}

/**
 * 기상청 API 응답 파싱
 */
function parseKMAResponse(items: Record<string, string>[], location: string): WeatherResult {
  const now = new Date();
  const currentHour = now.getHours().toString().padStart(2, '0') + '00';

  // 카테고리별로 데이터 그룹핑
  const dataByTime: Record<string, Record<string, string>> = {};

  for (const item of items) {
    const timeKey = `${item.fcstDate}_${item.fcstTime}`;
    if (!dataByTime[timeKey]) {
      dataByTime[timeKey] = {};
    }
    dataByTime[timeKey][item.category] = item.fcstValue;
  }

  // 현재 시간에 가장 가까운 데이터 찾기
  const timeKeys = Object.keys(dataByTime).sort();
  const currentTimeKey =
    timeKeys.find((key) => key.split('_')[1] >= currentHour) || timeKeys[0];
  const currentData = dataByTime[currentTimeKey] || {};

  // 예보 데이터 생성
  const forecast = timeKeys.slice(0, 12).map((timeKey) => {
    const data = dataByTime[timeKey];
    return {
      time: `${timeKey.split('_')[0].slice(4, 6)}/${timeKey.split('_')[0].slice(6, 8)} ${timeKey.split('_')[1].slice(0, 2)}시`,
      temperature: parseInt(data.TMP || data.T1H || '0'),
      sky: SKY_CODES[data.SKY] || '알 수 없음',
      precipitation: PTY_CODES[data.PTY] || '없음',
      precipitationProbability: parseInt(data.POP || '0'),
    };
  });

  return {
    location,
    date: now.toISOString().split('T')[0],
    current: {
      temperature: parseInt(currentData.TMP || currentData.T1H || '0'),
      humidity: parseInt(currentData.REH || '0'),
      sky: SKY_CODES[currentData.SKY] || '알 수 없음',
      precipitation: PTY_CODES[currentData.PTY] || '없음',
      windSpeed: parseFloat(currentData.WSD || '0'),
      windDirection: getWindDirection(parseInt(currentData.VEC || '0')),
    },
    forecast,
  };
}

/**
 * 기준 시간 계산 (기상청 API는 특정 시간에만 데이터 제공)
 */
function getBaseDateTime(): { baseDate: string; baseTime: string } {
  const now = new Date();
  const hours = now.getHours();

  // 기상청 단기예보 기준시간: 02, 05, 08, 11, 14, 17, 20, 23시
  const baseTimes = [2, 5, 8, 11, 14, 17, 20, 23];
  let baseTime = baseTimes[0];

  for (const time of baseTimes) {
    if (hours >= time + 1) {
      // API 생성에 약 1시간 소요
      baseTime = time;
    }
  }

  // 기준 날짜 계산 (자정 전후 처리)
  const baseDate = new Date(now);
  if (hours < 3 && baseTime === 23) {
    baseDate.setDate(baseDate.getDate() - 1);
  }

  return {
    baseDate: baseDate.toISOString().slice(0, 10).replace(/-/g, ''),
    baseTime: baseTime.toString().padStart(2, '0') + '00',
  };
}

/**
 * 지역명으로 좌표 찾기
 */
function findCoordinates(location: string): { nx: number; ny: number } | null {
  // 정확한 매칭
  if (CITY_COORDINATES[location]) {
    return CITY_COORDINATES[location];
  }

  // 부분 매칭
  for (const [city, coords] of Object.entries(CITY_COORDINATES)) {
    if (location.includes(city) || city.includes(location)) {
      return coords;
    }
  }

  return null;
}

/**
 * 날씨 조회 메인 함수
 */
export async function getWeather(location: string, date?: string): Promise<WeatherResult> {
  const coords = findCoordinates(location);

  if (coords) {
    // 기상청 API 사용
    try {
      const { baseDate, baseTime } = getBaseDateTime();
      const items = await fetchKMAWeather(coords.nx, coords.ny, baseDate, baseTime);
      return parseKMAResponse(items, location);
    } catch (error) {
      console.warn('기상청 API 실패, OpenWeatherMap으로 대체:', error);
    }
  }

  // OpenWeatherMap 백업
  return fetchOpenWeather(location);
}

/**
 * 날씨 결과를 자연어로 포맷팅
 */
export function formatWeatherMessage(weather: WeatherResult): string {
  const { location, current, forecast } = weather;

  let message = `🌤️ **${location} 날씨**\n\n`;
  message += `**현재 날씨**\n`;
  message += `• 기온: ${current.temperature}°C\n`;
  message += `• 하늘: ${current.sky}\n`;
  message += `• 습도: ${current.humidity}%\n`;
  message += `• 바람: ${current.windDirection} ${current.windSpeed}m/s\n`;

  if (current.precipitation !== '없음') {
    message += `• 강수: ${current.precipitation}\n`;
  }

  if (forecast.length > 0) {
    message += `\n**시간별 예보**\n`;
    for (const f of forecast.slice(0, 6)) {
      const precip = f.precipitationProbability > 0 ? ` 💧${f.precipitationProbability}%` : '';
      message += `• ${f.time}: ${f.temperature}°C ${f.sky}${precip}\n`;
    }
  }

  if (weather.alerts && weather.alerts.length > 0) {
    message += `\n⚠️ **기상 특보**\n`;
    for (const alert of weather.alerts) {
      message += `• ${alert}\n`;
    }
  }

  return message;
}
