/**
 * Security Guard - 데이터 유출 방지 및 해킹 대비 시스템
 *
 * 핵심 원칙:
 * 1. 모든 외부 데이터 전송은 명시적 동의 필수
 * 2. 의심스러운 패턴 감지 및 차단
 * 3. 이상 행동 탐지 및 경고
 * 4. 완전한 감사 추적
 */

import { getSupabase, isSupabaseConfigured } from "./supabase.js";
import { hashUserId } from "./user-settings.js";
import { logAction } from "./action-permissions.js";

// ============================================
// 보안 위협 카테고리
// ============================================

export type ThreatCategory =
  | "data_exfiltration"    // 데이터 유출 시도
  | "injection_attack"     // 명령 주입 공격
  | "privilege_escalation" // 권한 상승 시도
  | "brute_force"          // 무차별 대입 공격
  | "session_hijack"       // 세션 탈취 시도
  | "remote_control"       // 원격 조종 시도
  | "social_engineering"   // 사회공학적 공격
  | "data_harvesting"      // 데이터 수집 시도
  | "anomaly";             // 이상 행동

export type ThreatLevel = "low" | "medium" | "high" | "critical";

export interface SecurityThreat {
  category: ThreatCategory;
  level: ThreatLevel;
  description: string;
  evidence: string[];
  timestamp: Date;
  blocked: boolean;
}

// ============================================
// 데이터 유출 방지 카테고리
// ============================================

/**
 * 보호 대상 데이터 유형
 */
export type ProtectedDataType =
  | "contacts"           // 연락처/전화번호부
  | "messages"           // 대화 내용
  | "call_history"       // 통화 기록
  | "location"           // 위치 정보
  | "photos"             // 사진/이미지
  | "files"              // 파일/문서
  | "calendar"           // 일정/캘린더
  | "passwords"          // 비밀번호/인증정보
  | "financial"          // 금융 정보
  | "health"             // 건강 정보
  | "biometric"          // 생체 정보
  | "browsing_history"   // 브라우저 기록
  | "app_data"           // 앱 데이터
  | "clipboard"          // 클립보드
  | "screen_content"     // 화면 내용
  | "database";          // 데이터베이스 전체

/**
 * 보호 데이터 정보
 */
export interface ProtectedDataInfo {
  type: ProtectedDataType;
  name: string;
  description: string;
  riskLevel: ThreatLevel;
  requiresExplicitConsent: boolean;
  neverAllowedRemotely: boolean; // 원격 요청으로는 절대 불허
}

/**
 * 보호 대상 데이터 정의
 */
export const PROTECTED_DATA: Record<ProtectedDataType, ProtectedDataInfo> = {
  contacts: {
    type: "contacts",
    name: "연락처",
    description: "전화번호부, 연락처 정보",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  messages: {
    type: "messages",
    name: "메시지/대화",
    description: "문자, 카카오톡, 기타 메시지 내용",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  call_history: {
    type: "call_history",
    name: "통화 기록",
    description: "발신/수신 통화 내역",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  location: {
    type: "location",
    name: "위치 정보",
    description: "현재 위치, 위치 기록",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  photos: {
    type: "photos",
    name: "사진/이미지",
    description: "갤러리, 카메라 사진",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  files: {
    type: "files",
    name: "파일/문서",
    description: "저장된 파일 및 문서",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  calendar: {
    type: "calendar",
    name: "일정",
    description: "캘린더, 일정 정보",
    riskLevel: "medium",
    requiresExplicitConsent: true,
    neverAllowedRemotely: false,
  },
  passwords: {
    type: "passwords",
    name: "비밀번호",
    description: "비밀번호, 인증 정보, API 키",
    riskLevel: "critical",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true, // 절대 전송 불가
  },
  financial: {
    type: "financial",
    name: "금융 정보",
    description: "계좌번호, 카드정보, 거래내역",
    riskLevel: "critical",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  health: {
    type: "health",
    name: "건강 정보",
    description: "의료기록, 건강 데이터",
    riskLevel: "critical",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  biometric: {
    type: "biometric",
    name: "생체 정보",
    description: "지문, 얼굴인식, 홍채 데이터",
    riskLevel: "critical",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true, // 절대 전송 불가
  },
  browsing_history: {
    type: "browsing_history",
    name: "브라우저 기록",
    description: "방문 기록, 북마크, 쿠키",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  app_data: {
    type: "app_data",
    name: "앱 데이터",
    description: "설치된 앱, 앱 사용 기록",
    riskLevel: "medium",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  clipboard: {
    type: "clipboard",
    name: "클립보드",
    description: "복사된 텍스트, 이미지",
    riskLevel: "high",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  screen_content: {
    type: "screen_content",
    name: "화면 내용",
    description: "스크린샷, 화면 녹화",
    riskLevel: "critical",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true,
  },
  database: {
    type: "database",
    name: "데이터베이스",
    description: "저장된 모든 데이터",
    riskLevel: "critical",
    requiresExplicitConsent: true,
    neverAllowedRemotely: true, // 절대 전송 불가
  },
};

// ============================================
// 의심스러운 패턴 정의
// ============================================

interface SuspiciousPattern {
  id: string;
  name: string;
  pattern: RegExp;
  category: ThreatCategory;
  level: ThreatLevel;
  description: string;
}

/**
 * 의심스러운 명령 패턴
 */
const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  // 데이터 유출 시도
  {
    id: "exfil_contacts",
    name: "연락처 유출 시도",
    pattern: /(?:모든|전체)\s*(?:연락처|전화번호|주소록).*(?:보내|전송|추출|내보내|백업)/i,
    category: "data_exfiltration",
    level: "critical",
    description: "전체 연락처를 외부로 전송하려는 시도",
  },
  {
    id: "exfil_messages",
    name: "메시지 유출 시도",
    pattern: /(?:모든|전체|지난)\s*(?:대화|메시지|카톡|문자).*(?:보내|전송|추출|내보내)/i,
    category: "data_exfiltration",
    level: "critical",
    description: "대화 내용을 외부로 전송하려는 시도",
  },
  {
    id: "exfil_files",
    name: "파일 유출 시도",
    pattern: /(?:모든|전체)\s*(?:파일|문서|사진|동영상).*(?:보내|전송|업로드|내보내)/i,
    category: "data_exfiltration",
    level: "critical",
    description: "파일을 외부로 전송하려는 시도",
  },
  {
    id: "exfil_database",
    name: "데이터베이스 유출 시도",
    pattern: /(?:데이터베이스|db|sqlite|테이블).*(?:덤프|추출|내보내|백업|전송)/i,
    category: "data_exfiltration",
    level: "critical",
    description: "데이터베이스를 추출하려는 시도",
  },

  // 명령 주입 공격
  {
    id: "cmd_injection",
    name: "명령 주입",
    pattern: /[;&|`$]|\$\(|`.*`|system\s*\(|exec\s*\(|eval\s*\(/i,
    category: "injection_attack",
    level: "high",
    description: "시스템 명령 주입 시도",
  },
  {
    id: "sql_injection",
    name: "SQL 주입",
    pattern: /(?:union\s+select|drop\s+table|delete\s+from|insert\s+into|update\s+.*set|--\s*$|;\s*--)/i,
    category: "injection_attack",
    level: "high",
    description: "SQL 주입 시도",
  },
  {
    id: "path_traversal",
    name: "경로 순회",
    pattern: /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e\//i,
    category: "injection_attack",
    level: "high",
    description: "경로 순회 공격 시도",
  },

  // 권한 상승 시도
  {
    id: "priv_escalation",
    name: "권한 상승",
    pattern: /(?:sudo|su\s+-|chmod\s+777|root|admin|관리자|administrator)/i,
    category: "privilege_escalation",
    level: "high",
    description: "권한 상승 시도",
  },

  // 원격 조종 시도
  {
    id: "remote_shell",
    name: "원격 쉘",
    pattern: /(?:reverse\s*shell|bind\s*shell|nc\s+-|netcat|meterpreter)/i,
    category: "remote_control",
    level: "critical",
    description: "원격 쉘 연결 시도",
  },
  {
    id: "remote_access",
    name: "원격 접속",
    pattern: /(?:원격\s*(?:접속|제어|조종)|remote\s*(?:access|control)|vnc|rdp|teamviewer)/i,
    category: "remote_control",
    level: "high",
    description: "원격 접속 시도",
  },

  // 사회공학적 공격
  {
    id: "phishing_password",
    name: "비밀번호 피싱",
    pattern: /(?:비밀번호|패스워드|password).*(?:알려|말해|입력|보내)/i,
    category: "social_engineering",
    level: "high",
    description: "비밀번호 탈취 시도",
  },
  {
    id: "phishing_financial",
    name: "금융정보 피싱",
    pattern: /(?:계좌|카드|은행).*(?:번호|정보).*(?:알려|말해|입력|보내)/i,
    category: "social_engineering",
    level: "critical",
    description: "금융정보 탈취 시도",
  },

  // 데이터 수집 시도
  {
    id: "harvest_info",
    name: "정보 수집",
    pattern: /(?:이\s*사람|이\s*사용자|(?:나|너|저)의).*(?:모든|전체)\s*(?:정보|데이터)/i,
    category: "data_harvesting",
    level: "high",
    description: "개인정보 수집 시도",
  },

  // 숨김/우회 시도
  {
    id: "bypass_security",
    name: "보안 우회",
    pattern: /(?:보안|권한|인증|확인).*(?:우회|무시|끄|비활성화|disable)/i,
    category: "privilege_escalation",
    level: "critical",
    description: "보안 기능 우회 시도",
  },
  {
    id: "hide_activity",
    name: "활동 숨김",
    pattern: /(?:로그|기록|흔적).*(?:삭제|지우|숨기|hide|clear)/i,
    category: "anomaly",
    level: "high",
    description: "활동 흔적 삭제 시도",
  },
];

// ============================================
// 보안 검사 함수
// ============================================

export interface SecurityCheckResult {
  safe: boolean;
  threats: SecurityThreat[];
  blocked: boolean;
  message?: string;
  requiresConsent?: ProtectedDataType[];
}

/**
 * 메시지 보안 검사
 */
export function checkMessageSecurity(message: string): SecurityCheckResult {
  const threats: SecurityThreat[] = [];
  const requiresConsent: ProtectedDataType[] = [];

  // 1. 의심스러운 패턴 검사
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.pattern.test(message)) {
      threats.push({
        category: pattern.category,
        level: pattern.level,
        description: pattern.description,
        evidence: [message.slice(0, 100)],
        timestamp: new Date(),
        blocked: pattern.level === "critical",
      });
    }
  }

  // 2. 보호 데이터 접근 감지
  for (const [dataType, info] of Object.entries(PROTECTED_DATA)) {
    if (detectDataAccessIntent(message, dataType as ProtectedDataType)) {
      if (detectExternalTransferIntent(message)) {
        threats.push({
          category: "data_exfiltration",
          level: info.riskLevel,
          description: `${info.name} 외부 전송 시도 감지`,
          evidence: [message.slice(0, 100)],
          timestamp: new Date(),
          blocked: info.neverAllowedRemotely,
        });
      }
      if (info.requiresExplicitConsent) {
        requiresConsent.push(dataType as ProtectedDataType);
      }
    }
  }

  // 결과 분석
  const criticalThreats = threats.filter(t => t.level === "critical");
  const blocked = criticalThreats.length > 0;

  return {
    safe: threats.length === 0,
    threats,
    blocked,
    message: blocked
      ? "🚨 보안 위협이 감지되어 요청이 차단되었습니다."
      : undefined,
    requiresConsent: requiresConsent.length > 0 ? requiresConsent : undefined,
  };
}

/**
 * 특정 데이터 유형에 대한 접근 의도 감지
 */
function detectDataAccessIntent(message: string, dataType: ProtectedDataType): boolean {
  const keywords: Record<ProtectedDataType, RegExp> = {
    contacts: /연락처|전화번호|주소록|contact/i,
    messages: /메시지|대화|카톡|문자|채팅|message|chat/i,
    call_history: /통화\s*(?:기록|내역|로그)|call\s*(?:log|history)/i,
    location: /위치|GPS|좌표|location/i,
    photos: /사진|이미지|갤러리|photo|image|gallery/i,
    files: /파일|문서|다운로드|file|document/i,
    calendar: /일정|캘린더|스케줄|calendar|schedule/i,
    passwords: /비밀번호|패스워드|암호|password|credential/i,
    financial: /계좌|카드|은행|거래|account|card|bank/i,
    health: /건강|의료|진료|health|medical/i,
    biometric: /지문|얼굴|홍채|생체|fingerprint|face|biometric/i,
    browsing_history: /방문\s*기록|브라우저|히스토리|browser|history/i,
    app_data: /앱\s*(?:데이터|목록)|설치된\s*앱|app\s*data/i,
    clipboard: /클립보드|복사|붙여넣기|clipboard|paste/i,
    screen_content: /화면|스크린샷|녹화|screen|screenshot/i,
    database: /데이터베이스|db|sqlite|테이블|database|table/i,
  };

  return keywords[dataType]?.test(message) ?? false;
}

/**
 * 외부 전송 의도 감지 (아웃바운드 - 데이터가 나가는 것)
 *
 * 중요: 크롤링/스크래핑 등 데이터를 가져오는 인바운드 작업은 감지하지 않음
 */
function detectExternalTransferIntent(message: string): boolean {
  // 먼저 인바운드(데이터 가져오기) 작업인지 확인 - 인바운드는 허용
  if (detectInboundOperation(message)) {
    return false;
  }

  // 아웃바운드(데이터 내보내기) 패턴만 감지
  const outboundPatterns = [
    /(?:내\s*)?(?:연락처|메시지|파일|데이터|정보).*(?:보내|전송|업로드|upload|send|forward)/i,
    /(?:연락처|메시지|파일|데이터|정보).*(?:추출|내보내|export|extract)/i,
    /(?:연락처|메시지|파일|데이터|정보).*(?:외부|서버|클라우드).*(?:전송|저장|업로드)/i,
    /(?:이메일|메일).*(?:첨부.*보내|발송)/i,
    /(?:서버|클라우드|외부).*(?:로|에)\s*(?:전송|업로드|보내)/i,
    /(?:백업|dump|덤프).*(?:서버|클라우드|외부)/i,
  ];

  return outboundPatterns.some(p => p.test(message));
}

/**
 * 인바운드 작업 감지 (데이터를 가져오는 작업 - 허용됨)
 *
 * 웹 크롤링, 스크래핑, 외부 API 호출 등 데이터를 '가져오는' 작업은
 * 데이터 유출이 아니므로 차단하지 않음
 */
export function detectInboundOperation(message: string): boolean {
  const inboundPatterns = [
    // 크롤링/스크래핑
    /크롤링|크롤|crawl|scraping|스크래핑|스크랩/i,
    // 데이터 가져오기
    /(?:웹|사이트|페이지|url).*(?:에서|로부터).*(?:가져|추출|읽|긁어|수집)/i,
    /(?:가져|불러|다운로드|download|fetch|get).*(?:웹|사이트|페이지|url|api)/i,
    // 검색/조회
    /(?:검색|찾아|조회|search|find|lookup).*(?:해|줘|주세요)/i,
    // 외부 API 호출
    /(?:api|API).*(?:호출|call|요청|request)/i,
    /(?:외부|external).*(?:api|API|서비스).*(?:조회|요청|호출)/i,
    // 뉴스/정보 수집
    /(?:뉴스|기사|정보|데이터).*(?:수집|모아|가져)/i,
    /(?:실시간|최신).*(?:정보|데이터|가격|환율)/i,
    // RSS/피드
    /rss|피드|feed/i,
    // 날씨, 주식 등 외부 정보 조회
    /(?:날씨|주식|환율|시세).*(?:알려|조회|확인)/i,
  ];

  return inboundPatterns.some(p => p.test(message));
}

// ============================================
// 세션 보안
// ============================================

interface SessionInfo {
  userId: string;
  deviceId: string;
  createdAt: Date;
  lastActivity: Date;
  ipAddress?: string;
  userAgent?: string;
  requestCount: number;
  failedAttempts: number;
  isLocked: boolean;
}

const sessions = new Map<string, SessionInfo>();
const blockedIPs = new Set<string>();
const blockedUsers = new Set<string>();

/**
 * 세션 검증
 */
export function validateSession(
  kakaoUserId: string,
  deviceId?: string,
  ipAddress?: string,
): {
  valid: boolean;
  reason?: string;
  session?: SessionInfo;
} {
  // IP 차단 확인
  if (ipAddress && blockedIPs.has(ipAddress)) {
    return { valid: false, reason: "IP 주소가 차단되었습니다." };
  }

  // 사용자 차단 확인
  if (blockedUsers.has(kakaoUserId)) {
    return { valid: false, reason: "계정이 일시적으로 차단되었습니다." };
  }

  const sessionKey = `${kakaoUserId}_${deviceId ?? "default"}`;
  let session = sessions.get(sessionKey);

  if (!session) {
    // 새 세션 생성
    session = {
      userId: kakaoUserId,
      deviceId: deviceId ?? "default",
      createdAt: new Date(),
      lastActivity: new Date(),
      ipAddress,
      requestCount: 0,
      failedAttempts: 0,
      isLocked: false,
    };
    sessions.set(sessionKey, session);
  }

  // 세션 잠금 확인
  if (session.isLocked) {
    return { valid: false, reason: "세션이 잠겨있습니다. 잠시 후 다시 시도해주세요." };
  }

  // 활동 업데이트
  session.lastActivity = new Date();
  session.requestCount++;

  return { valid: true, session };
}

/**
 * 실패 시도 기록
 */
export function recordFailedAttempt(kakaoUserId: string, deviceId?: string): void {
  const sessionKey = `${kakaoUserId}_${deviceId ?? "default"}`;
  const session = sessions.get(sessionKey);

  if (session) {
    session.failedAttempts++;

    // 5회 실패 시 세션 잠금
    if (session.failedAttempts >= 5) {
      session.isLocked = true;
      void logSecurityEvent(kakaoUserId, "session_locked", {
        reason: "Too many failed attempts",
        attempts: session.failedAttempts,
      });

      // 10분 후 자동 해제
      setTimeout(() => {
        session.isLocked = false;
        session.failedAttempts = 0;
      }, 10 * 60 * 1000);
    }
  }
}

// ============================================
// 속도 제한 (Rate Limiting)
// ============================================

interface RateLimitEntry {
  count: number;
  windowStart: Date;
}

const rateLimits = new Map<string, RateLimitEntry>();

/**
 * 속도 제한 확인
 */
export function checkRateLimit(
  kakaoUserId: string,
  limit: number = 30,    // 기본 30회
  windowMs: number = 60000, // 1분
): {
  allowed: boolean;
  remaining: number;
  resetIn: number;
} {
  const now = new Date();
  let entry = rateLimits.get(kakaoUserId);

  if (!entry || now.getTime() - entry.windowStart.getTime() > windowMs) {
    // 새 윈도우 시작
    entry = { count: 0, windowStart: now };
    rateLimits.set(kakaoUserId, entry);
  }

  entry.count++;

  const remaining = Math.max(0, limit - entry.count);
  const resetIn = windowMs - (now.getTime() - entry.windowStart.getTime());

  if (entry.count > limit) {
    void logSecurityEvent(kakaoUserId, "rate_limit_exceeded", {
      count: entry.count,
      limit,
    });

    return {
      allowed: false,
      remaining: 0,
      resetIn,
    };
  }

  return {
    allowed: true,
    remaining,
    resetIn,
  };
}

// ============================================
// 이상 행동 탐지
// ============================================

interface BehaviorProfile {
  userId: string;
  avgRequestsPerHour: number;
  avgMessageLength: number;
  typicalHours: number[]; // 0-23
  lastPatterns: string[];
  createdAt: Date;
  updatedAt: Date;
}

const behaviorProfiles = new Map<string, BehaviorProfile>();

/**
 * 이상 행동 분석
 *
 * 중요: 반복적인 크롤링/검색 작업은 이상 행동으로 판단하지 않음
 * 이상 행동은 데이터 '유출' 시도와 관련된 것만 감지
 */
export function analyzeAnomalies(
  kakaoUserId: string,
  message: string,
): {
  isAnomalous: boolean;
  anomalies: string[];
  riskScore: number;
  isInboundOperation: boolean;
} {
  const anomalies: string[] = [];
  let riskScore = 0;

  // 인바운드 작업(크롤링, 검색 등)인지 확인 - 인바운드는 반복해도 문제없음
  const isInbound = detectInboundOperation(message);
  if (isInbound) {
    // 인바운드 작업은 이상 행동으로 취급하지 않음
    return {
      isAnomalous: false,
      anomalies: [],
      riskScore: 0,
      isInboundOperation: true,
    };
  }

  const profile = behaviorProfiles.get(kakaoUserId);
  const currentHour = new Date().getHours();

  // 1. 비정상적인 활동 시간 (데이터 유출 시도와 연관될 때만)
  //    단순 활동 시간만으로는 차단하지 않음
  if (profile && !profile.typicalHours.includes(currentHour)) {
    // 다른 위협 징후와 함께 있을 때만 점수 추가
    if (detectExternalTransferIntent(message)) {
      anomalies.push("비정상적인 시간대에 데이터 전송 시도");
      riskScore += 15;
    }
  }

  // 2. 비정상적으로 긴 메시지 (아웃바운드 시도와 연관될 때만)
  if (message.length > 2000 && detectExternalTransferIntent(message)) {
    anomalies.push("대량 데이터 전송 시도");
    riskScore += 25;
  }

  // 3. 반복적인 데이터 유출 시도 패턴만 감지
  //    일반적인 반복 패턴은 문제없음 (크롤링 등)
  if (profile && detectExternalTransferIntent(message)) {
    const recentPatterns = profile.lastPatterns.slice(-10);
    const messagePattern = message.slice(0, 50);
    const repetitions = recentPatterns.filter(p => p === messagePattern).length;

    if (repetitions >= 3) {
      anomalies.push("반복적인 데이터 유출 시도");
      riskScore += 35;
    }

    // 패턴 업데이트
    profile.lastPatterns.push(messagePattern);
    if (profile.lastPatterns.length > 50) {
      profile.lastPatterns.shift();
    }
  }

  // 4. Base64/인코딩된 데이터 (아웃바운드와 연관될 때만 의심)
  if (/^[A-Za-z0-9+/]{50,}={0,2}$/.test(message.replace(/\s/g, "")) &&
      detectExternalTransferIntent(message)) {
    anomalies.push("인코딩된 데이터 전송 시도");
    riskScore += 45;
  }

  // 5. 스크립트/코드 감지 - 보안 우회 시도
  if (/<script|<\/script|javascript:|data:text\/html/i.test(message)) {
    anomalies.push("스크립트 삽입 시도");
    riskScore += 50;
  }

  return {
    isAnomalous: anomalies.length > 0,
    anomalies,
    riskScore: Math.min(100, riskScore),
    isInboundOperation: false,
  };
}

/**
 * 외부 전송 의도 감지를 위한 간단한 내부 헬퍼
 */
function detectExternalTransferIntent(message: string): boolean {
  // 먼저 인바운드 작업인지 확인
  if (detectInboundOperation(message)) {
    return false;
  }

  const outboundPatterns = [
    /(?:내\s*)?(?:연락처|메시지|파일|데이터|정보).*(?:보내|전송|업로드)/i,
    /(?:연락처|메시지|파일|데이터|정보).*(?:추출|내보내)/i,
    /(?:서버|클라우드|외부).*(?:로|에)\s*(?:전송|업로드|보내)/i,
  ];

  return outboundPatterns.some(p => p.test(message));
}

// ============================================
// 데이터 전송 동의 관리
// ============================================

interface DataTransferConsent {
  dataType: ProtectedDataType;
  granted: boolean;
  grantedAt?: Date;
  expiresAt?: Date;
  destination?: string;
  purpose?: string;
}

const dataTransferConsents = new Map<string, DataTransferConsent[]>();

/**
 * 데이터 전송 동의 확인
 */
export async function checkDataTransferConsent(
  kakaoUserId: string,
  dataType: ProtectedDataType,
  destination?: string,
): Promise<{
  consented: boolean;
  consent?: DataTransferConsent;
  neverAllowed?: boolean;
  message?: string;
}> {
  const dataInfo = PROTECTED_DATA[dataType];

  // 절대 허용 불가 데이터
  if (dataInfo.neverAllowedRemotely) {
    return {
      consented: false,
      neverAllowed: true,
      message: `🚫 보안상의 이유로 "${dataInfo.name}"은(는) 외부로 전송할 수 없습니다.`,
    };
  }

  const consents = dataTransferConsents.get(kakaoUserId) ?? [];
  const consent = consents.find(c =>
    c.dataType === dataType &&
    c.granted &&
    (!c.expiresAt || new Date(c.expiresAt) > new Date()) &&
    (!destination || !c.destination || c.destination === destination)
  );

  if (consent) {
    return { consented: true, consent };
  }

  return {
    consented: false,
    message: `⚠️ "${dataInfo.name}" 전송에 대한 동의가 필요합니다.`,
  };
}

/**
 * 데이터 전송 동의 부여
 */
export async function grantDataTransferConsent(
  kakaoUserId: string,
  dataType: ProtectedDataType,
  options: {
    destination?: string;
    purpose?: string;
    expiresIn?: number;
  } = {},
): Promise<void> {
  const dataInfo = PROTECTED_DATA[dataType];

  // 절대 허용 불가 데이터는 동의 불가
  if (dataInfo.neverAllowedRemotely) {
    throw new Error(`${dataInfo.name}은(는) 외부 전송이 허용되지 않습니다.`);
  }

  const consent: DataTransferConsent = {
    dataType,
    granted: true,
    grantedAt: new Date(),
    expiresAt: options.expiresIn
      ? new Date(Date.now() + options.expiresIn)
      : new Date(Date.now() + 30 * 60 * 1000), // 기본 30분
    destination: options.destination,
    purpose: options.purpose,
  };

  const consents = dataTransferConsents.get(kakaoUserId) ?? [];
  consents.push(consent);
  dataTransferConsents.set(kakaoUserId, consents);

  await logSecurityEvent(kakaoUserId, "data_transfer_consent_granted", {
    dataType,
    destination: options.destination,
    purpose: options.purpose,
    expiresAt: consent.expiresAt,
  });
}

// ============================================
// 보안 이벤트 로깅
// ============================================

export async function logSecurityEvent(
  kakaoUserId: string,
  eventType: string,
  details: Record<string, unknown>,
): Promise<void> {
  const hashedId = hashUserId(kakaoUserId);

  console.log(`[SECURITY] ${hashedId.slice(0, 8)}... | ${eventType} | ${JSON.stringify(details)}`);

  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase.from("security_events").insert({
      user_id: hashedId,
      event_type: eventType,
      details,
      severity: details.level ?? "info",
    });
  }

  // 위협 이벤트는 action_audit_log에도 기록
  if (eventType.includes("threat") || eventType.includes("blocked")) {
    await logAction(kakaoUserId, `security:${eventType}`, details, "blocked");
  }
}

// ============================================
// 메시지 포맷팅
// ============================================

/**
 * 보안 경고 메시지 생성
 */
export function formatSecurityWarning(result: SecurityCheckResult): string {
  if (result.safe) {
    return "";
  }

  const lines = ["🔒 **보안 알림**", ""];

  if (result.blocked) {
    lines.push("🚨 보안 위협이 감지되어 요청이 차단되었습니다.", "");
  }

  if (result.threats.length > 0) {
    lines.push("**감지된 위협:**");
    for (const threat of result.threats) {
      const icon = {
        low: "🟢",
        medium: "🟡",
        high: "🟠",
        critical: "🔴",
      }[threat.level];
      lines.push(`${icon} ${threat.description}`);
    }
    lines.push("");
  }

  if (result.requiresConsent && result.requiresConsent.length > 0) {
    lines.push("**동의가 필요한 데이터:**");
    for (const dataType of result.requiresConsent) {
      const info = PROTECTED_DATA[dataType];
      lines.push(`• ${info.name}: ${info.description}`);
    }
    lines.push("");
    lines.push("해당 데이터에 접근하려면 명시적인 동의가 필요합니다.");
  }

  return lines.join("\n");
}

/**
 * 데이터 전송 동의 요청 메시지 생성
 */
export function formatDataTransferConsentRequest(
  dataType: ProtectedDataType,
  destination?: string,
): string {
  const info = PROTECTED_DATA[dataType];

  const riskIcon = {
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    critical: "🔴",
  }[info.riskLevel];

  return `⚠️ **데이터 전송 동의 요청**

${riskIcon} **${info.name}**
${info.description}

${destination ? `📤 전송 대상: ${destination}\n` : ""}
이 데이터를 외부로 전송하려면 명시적인 동의가 필요합니다.

동의하시겠습니까? ("네" / "아니오")

⏱️ 동의는 30분간 유효합니다.`;
}
