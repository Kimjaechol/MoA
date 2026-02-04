/**
 * 스포츠 일정 조회 Tool
 *
 * KBO, K리그, NBA, EPL 등 주요 스포츠 경기 일정 조회
 */

export interface SportsMatch {
  id: string;
  sport: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  venue?: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed';
  score?: {
    home: number;
    away: number;
  };
  broadcast?: string;
}

export interface SportsResult {
  sport: string;
  league?: string;
  matches: SportsMatch[];
  date: string;
}

// 한국 스포츠 팀 매핑
const KBO_TEAMS: Record<string, string> = {
  두산: 'Doosan Bears',
  LG: 'LG Twins',
  삼성: 'Samsung Lions',
  키움: 'Kiwoom Heroes',
  KT: 'KT Wiz',
  SSG: 'SSG Landers',
  롯데: 'Lotte Giants',
  한화: 'Hanwha Eagles',
  NC: 'NC Dinos',
  KIA: 'KIA Tigers',
  기아: 'KIA Tigers',
};

const KLEAGUE_TEAMS: Record<string, string> = {
  전북: 'Jeonbuk Hyundai Motors',
  울산: 'Ulsan HD',
  포항: 'Pohang Steelers',
  수원: 'Suwon Samsung Bluewings',
  FC서울: 'FC Seoul',
  서울: 'FC Seoul',
  인천: 'Incheon United',
  대구: 'Daegu FC',
  강원: 'Gangwon FC',
  제주: 'Jeju United',
  광주: 'Gwangju FC',
  대전: 'Daejeon Hana Citizen',
  김천: 'Gimcheon Sangmu',
};

/**
 * API-Football을 통한 스포츠 일정 조회
 */
async function fetchFromApiFootball(
  sport: string,
  league?: string,
  date?: string,
): Promise<SportsMatch[]> {
  const apiKey = process.env.API_FOOTBALL_KEY;

  if (!apiKey) {
    throw new Error('API-Football 키가 설정되지 않았습니다');
  }

  const targetDate = date || new Date().toISOString().slice(0, 10);

  // 리그 ID 매핑
  const leagueIds: Record<string, number> = {
    KBO: 0, // API-Football은 축구 전용
    K리그: 292,
    'K리그1': 292,
    EPL: 39,
    '프리미어리그': 39,
    라리가: 140,
    분데스리가: 78,
    세리에A: 135,
    리그앙: 61,
    챔피언스리그: 2,
    UCL: 2,
  };

  const leagueId = league ? leagueIds[league] : undefined;

  if (sport === 'soccer' || sport === 'football') {
    const url = new URL('https://v3.football.api-sports.io/fixtures');
    url.searchParams.set('date', targetDate);
    if (leagueId) {
      url.searchParams.set('league', leagueId.toString());
    }

    const response = await fetch(url.toString(), {
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'v3.football.api-sports.io',
      },
    });

    if (!response.ok) {
      throw new Error(`API-Football 오류: ${response.status}`);
    }

    const data = await response.json();

    return (data.response || []).map(
      (match: {
        fixture: {
          id: number;
          date: string;
          venue?: { name: string };
          status: { short: string };
        };
        league: { name: string };
        teams: {
          home: { name: string };
          away: { name: string };
        };
        goals: { home: number | null; away: number | null };
      }) => ({
        id: match.fixture.id.toString(),
        sport: 'soccer',
        league: match.league.name,
        homeTeam: match.teams.home.name,
        awayTeam: match.teams.away.name,
        startTime: match.fixture.date,
        venue: match.fixture.venue?.name,
        status: mapApiFootballStatus(match.fixture.status.short),
        score:
          match.goals.home !== null
            ? { home: match.goals.home, away: match.goals.away || 0 }
            : undefined,
      }),
    );
  }

  return [];
}

function mapApiFootballStatus(
  status: string,
): 'scheduled' | 'live' | 'finished' | 'postponed' {
  const statusMap: Record<string, 'scheduled' | 'live' | 'finished' | 'postponed'> = {
    NS: 'scheduled',
    TBD: 'scheduled',
    '1H': 'live',
    HT: 'live',
    '2H': 'live',
    ET: 'live',
    P: 'live',
    FT: 'finished',
    AET: 'finished',
    PEN: 'finished',
    PST: 'postponed',
    CANC: 'postponed',
  };
  return statusMap[status] || 'scheduled';
}

/**
 * ESPN API를 통한 스포츠 일정 조회 (무료)
 */
async function fetchFromESPN(
  sport: string,
  league?: string,
  date?: string,
): Promise<SportsMatch[]> {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const formattedDate = targetDate.replace(/-/g, '');

  // ESPN API 엔드포인트 매핑
  const endpoints: Record<string, { sport: string; league: string }> = {
    // 농구
    NBA: { sport: 'basketball', league: 'nba' },
    WNBA: { sport: 'basketball', league: 'wnba' },
    KBL: { sport: 'basketball', league: 'kbl' },
    // 야구
    MLB: { sport: 'baseball', league: 'mlb' },
    KBO: { sport: 'baseball', league: 'kbo' },
    NPB: { sport: 'baseball', league: 'npb' },
    // 축구
    EPL: { sport: 'soccer', league: 'eng.1' },
    라리가: { sport: 'soccer', league: 'esp.1' },
    분데스리가: { sport: 'soccer', league: 'ger.1' },
    세리에A: { sport: 'soccer', league: 'ita.1' },
    K리그: { sport: 'soccer', league: 'kor.1' },
    'K리그1': { sport: 'soccer', league: 'kor.1' },
    // 미식축구
    NFL: { sport: 'football', league: 'nfl' },
    // 하키
    NHL: { sport: 'hockey', league: 'nhl' },
  };

  // 리그 찾기
  let endpoint = league ? endpoints[league] : null;

  if (!endpoint) {
    // 스포츠 종류로 기본 리그 선택
    const defaultLeagues: Record<string, string> = {
      baseball: 'KBO',
      basketball: 'NBA',
      soccer: 'EPL',
      football: 'NFL',
    };
    const defaultLeague = defaultLeagues[sport];
    endpoint = defaultLeague ? endpoints[defaultLeague] : null;
  }

  if (!endpoint) {
    return [];
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/${endpoint.sport}/${endpoint.league}/scoreboard?dates=${formattedDate}`;

    const response = await fetch(url);

    if (!response.ok) {
      console.warn(`ESPN API 오류: ${response.status}`);
      return [];
    }

    const data = await response.json();

    return (data.events || []).map(
      (event: {
        id: string;
        date: string;
        name: string;
        competitions: {
          venue?: { fullName: string };
          status: { type: { name: string } };
          competitors: {
            homeAway: string;
            team: { displayName: string };
            score: string;
          }[];
          broadcasts?: { names: string[] }[];
        }[];
      }) => {
        const competition = event.competitions[0];
        const homeTeam = competition.competitors.find((c) => c.homeAway === 'home');
        const awayTeam = competition.competitors.find((c) => c.homeAway === 'away');

        return {
          id: event.id,
          sport: endpoint!.sport,
          league: league || endpoint!.league.toUpperCase(),
          homeTeam: homeTeam?.team.displayName || '',
          awayTeam: awayTeam?.team.displayName || '',
          startTime: event.date,
          venue: competition.venue?.fullName,
          status: mapESPNStatus(competition.status.type.name),
          score:
            homeTeam?.score && awayTeam?.score
              ? {
                  home: parseInt(homeTeam.score),
                  away: parseInt(awayTeam.score),
                }
              : undefined,
          broadcast: competition.broadcasts?.[0]?.names?.join(', '),
        };
      },
    );
  } catch (error) {
    console.error('ESPN API 조회 실패:', error);
    return [];
  }
}

function mapESPNStatus(status: string): 'scheduled' | 'live' | 'finished' | 'postponed' {
  const statusMap: Record<string, 'scheduled' | 'live' | 'finished' | 'postponed'> = {
    STATUS_SCHEDULED: 'scheduled',
    STATUS_IN_PROGRESS: 'live',
    STATUS_HALFTIME: 'live',
    STATUS_FINAL: 'finished',
    STATUS_FULL_TIME: 'finished',
    STATUS_POSTPONED: 'postponed',
    STATUS_CANCELED: 'postponed',
  };
  return statusMap[status] || 'scheduled';
}

/**
 * 스포츠 일정 조회 메인 함수
 */
export async function getSportsSchedule(params: {
  sport: string;
  league?: string;
  team?: string;
  date?: string;
}): Promise<SportsResult> {
  const { sport, league, team, date } = params;
  const targetDate = date || new Date().toISOString().slice(0, 10);

  let matches: SportsMatch[] = [];

  // ESPN API 우선 사용 (무료)
  matches = await fetchFromESPN(sport, league, targetDate);

  // API-Football 백업 (축구 전용)
  if (matches.length === 0 && (sport === 'soccer' || sport === 'football')) {
    try {
      matches = await fetchFromApiFootball(sport, league, targetDate);
    } catch {
      console.warn('API-Football 조회 실패, ESPN 결과 사용');
    }
  }

  // 팀 필터링
  if (team && matches.length > 0) {
    const normalizedTeam = team.toLowerCase();
    const teamMapping =
      sport === 'baseball' ? KBO_TEAMS : sport === 'soccer' ? KLEAGUE_TEAMS : {};

    const mappedTeam = teamMapping[team] || team;

    matches = matches.filter(
      (match) =>
        match.homeTeam.toLowerCase().includes(normalizedTeam) ||
        match.awayTeam.toLowerCase().includes(normalizedTeam) ||
        match.homeTeam.toLowerCase().includes(mappedTeam.toLowerCase()) ||
        match.awayTeam.toLowerCase().includes(mappedTeam.toLowerCase()),
    );
  }

  return {
    sport,
    league,
    matches,
    date: targetDate,
  };
}

/**
 * 스포츠 결과를 자연어로 포맷팅
 */
export function formatSportsMessage(result: SportsResult): string {
  const { sport, league, matches, date } = result;

  const sportNames: Record<string, string> = {
    baseball: '야구',
    basketball: '농구',
    soccer: '축구',
    football: '미식축구',
    hockey: '하키',
  };

  const sportName = sportNames[sport] || sport;
  const leagueName = league || '';

  if (matches.length === 0) {
    return `⚽ ${date} ${leagueName} ${sportName} 경기 일정이 없습니다.`;
  }

  let message = `⚽ **${date} ${leagueName} ${sportName} 일정**\n\n`;

  for (const match of matches) {
    const time = new Date(match.startTime).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const statusEmoji = {
      scheduled: '🕐',
      live: '🔴',
      finished: '✅',
      postponed: '⚠️',
    }[match.status];

    let matchLine = `${statusEmoji} ${time} | ${match.homeTeam}`;

    if (match.score) {
      matchLine += ` ${match.score.home} - ${match.score.away} `;
    } else {
      matchLine += ' vs ';
    }

    matchLine += match.awayTeam;

    if (match.venue) {
      matchLine += `\n   📍 ${match.venue}`;
    }

    if (match.broadcast) {
      matchLine += `\n   📺 ${match.broadcast}`;
    }

    message += matchLine + '\n\n';
  }

  return message.trim();
}

/**
 * 자연어 쿼리에서 스포츠/리그/팀 추출
 */
export function parseSportsQuery(query: string): {
  sport: string;
  league?: string;
  team?: string;
  date?: string;
} {
  const lowerQuery = query.toLowerCase();

  // 스포츠 종류 감지
  let sport = 'soccer';
  if (
    lowerQuery.includes('야구') ||
    lowerQuery.includes('kbo') ||
    lowerQuery.includes('mlb')
  ) {
    sport = 'baseball';
  } else if (
    lowerQuery.includes('농구') ||
    lowerQuery.includes('nba') ||
    lowerQuery.includes('kbl')
  ) {
    sport = 'basketball';
  } else if (
    lowerQuery.includes('축구') ||
    lowerQuery.includes('k리그') ||
    lowerQuery.includes('epl') ||
    lowerQuery.includes('프리미어')
  ) {
    sport = 'soccer';
  }

  // 리그 감지
  let league: string | undefined;
  const leaguePatterns: [RegExp, string][] = [
    [/kbo|프로야구/, 'KBO'],
    [/mlb|메이저리그/, 'MLB'],
    [/nba/, 'NBA'],
    [/kbl|프로농구/, 'KBL'],
    [/k리그|케이리그/, 'K리그'],
    [/epl|프리미어|잉글랜드/, 'EPL'],
    [/라리가|스페인/, '라리가'],
    [/분데스|독일/, '분데스리가'],
    [/세리에|이탈리아/, '세리에A'],
    [/챔스|챔피언스리그|ucl/, 'UCL'],
  ];

  for (const [pattern, leagueName] of leaguePatterns) {
    if (pattern.test(lowerQuery)) {
      league = leagueName;
      break;
    }
  }

  // 팀 감지 (한국 팀)
  let team: string | undefined;
  const allTeams = { ...KBO_TEAMS, ...KLEAGUE_TEAMS };
  for (const teamName of Object.keys(allTeams)) {
    if (lowerQuery.includes(teamName.toLowerCase())) {
      team = teamName;
      break;
    }
  }

  // 날짜 감지
  let date: string | undefined;
  const today = new Date();

  if (lowerQuery.includes('오늘')) {
    date = today.toISOString().slice(0, 10);
  } else if (lowerQuery.includes('내일')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    date = tomorrow.toISOString().slice(0, 10);
  } else if (lowerQuery.includes('어제')) {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    date = yesterday.toISOString().slice(0, 10);
  } else {
    // YYYY-MM-DD 또는 MM/DD 패턴 찾기
    const dateMatch = query.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}\/\d{1,2})/);
    if (dateMatch) {
      if (dateMatch[1]) {
        date = dateMatch[1];
      } else if (dateMatch[2]) {
        const [month, day] = dateMatch[2].split('/');
        date = `${today.getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
  }

  return { sport, league, team, date };
}
