/**
 * 통역 세션 상태 관리
 *
 * 자연스러운 대화 흐름:
 * 1. 사용자: "통역해줘" (어떤 표현이든)
 * 2. MoA: "어느 나라 말로 통역할까요?" + 언어 선택 버튼
 * 3. 사용자: "영어" / "일본어" / "English" 등
 * 4. MoA: "지금부터 요청하신 영어로 통역을 하겠습니다." → Live API 모드 시작
 *
 * 각 사용자별 대화 상태를 추적하여, "언어 선택 대기 중"일 때
 * 다음 메시지를 언어 응답으로 처리.
 */

import {
  findLanguageByKeyword,
  findLanguageByCode,
  type LanguageInfo,
} from "./gemini-live-translate.js";

// ==================== Session State ====================

export type SessionPhase =
  | "idle"                 // 대기 (통역 세션 없음)
  | "awaiting_language"    // "어느 나라 말로 통역할까요?" 질문 후 대기
  | "active";             // 통역 세션 활성화

export interface TranslationSessionState {
  phase: SessionPhase;
  /** 선택된 타겟 언어 */
  targetLanguage?: LanguageInfo;
  /** 맥락 (식당, 비즈니스 등) */
  context?: string;
  /** 상태 전환 시각 (자동 만료용) */
  updatedAt: number;
}

// 사용자별 세션 상태 (in-memory)
const sessions = new Map<string, TranslationSessionState>();

// 5분 뒤 자동 만료 (언어 선택 안 하면 리셋)
const SESSION_TTL_MS = 5 * 60 * 1000;

// ==================== 세션 관리 ====================

/**
 * 사용자 세션 상태 가져오기
 */
export function getSessionState(userId: string): TranslationSessionState {
  const session = sessions.get(userId);

  // 만료 체크
  if (session && Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(userId);
    return { phase: "idle", updatedAt: Date.now() };
  }

  return session ?? { phase: "idle", updatedAt: Date.now() };
}

/**
 * "어느 나라 말로 통역할까요?" 상태로 전환
 */
export function setAwaitingLanguage(userId: string, context?: string): void {
  sessions.set(userId, {
    phase: "awaiting_language",
    context,
    updatedAt: Date.now(),
  });
}

/**
 * 통역 세션 활성화 (언어 선택 완료)
 */
export function setSessionActive(userId: string, language: LanguageInfo, context?: string): void {
  sessions.set(userId, {
    phase: "active",
    targetLanguage: language,
    context,
    updatedAt: Date.now(),
  });
}

/**
 * 세션 종료 (idle로 복귀)
 */
export function endSession(userId: string): void {
  sessions.delete(userId);
}

/**
 * 사용자가 "언어 선택 대기 중"인지 확인
 */
export function isAwaitingLanguage(userId: string): boolean {
  return getSessionState(userId).phase === "awaiting_language";
}

// ==================== 언어 응답 파싱 ====================

/**
 * 사용자의 자유 텍스트에서 언어를 파싱
 *
 * 다양한 입력 형태 처리:
 * - "영어" / "영어요" / "영어로" / "영어로 해줘"
 * - "English" / "japanese" / "chinese"
 * - "일본어로 부탁해" / "스페인어"
 * - "🇯🇵" (국기 이모지)
 */
export function parseLanguageResponse(message: string): LanguageInfo | undefined {
  const cleaned = message
    .replace(/요$|로$|로\s*해줘|로\s*부탁|로\s*해$|해줘|부탁|해$|으로|좀|ᆞ/g, "")
    .trim();

  // 1. 직접 키워드 매칭
  const direct = findLanguageByKeyword(cleaned);
  if (direct) return direct;

  // 2. 국기 이모지 매칭
  const flagMap: Record<string, string> = {
    "🇯🇵": "ja", "🇺🇸": "en", "🇬🇧": "en", "🇨🇳": "zh", "🇪🇸": "es",
    "🇫🇷": "fr", "🇩🇪": "de", "🇧🇷": "pt", "🇷🇺": "ru", "🇮🇹": "it",
    "🇸🇦": "ar", "🇮🇳": "hi", "🇹🇭": "th", "🇻🇳": "vi", "🇮🇩": "id",
    "🇲🇾": "ms", "🇹🇷": "tr", "🇳🇱": "nl", "🇵🇱": "pl", "🇸🇪": "sv",
    "🇩🇰": "da", "🇳🇴": "no", "🇫🇮": "fi", "🇬🇷": "el", "🇨🇿": "cs",
    "🇺🇦": "uk", "🇵🇭": "tl", "🇰🇷": "ko",
  };
  for (const [flag, code] of Object.entries(flagMap)) {
    if (message.includes(flag)) {
      return findLanguageByCode(code);
    }
  }

  // 3. 영어 이름 매칭
  const englishNames: Record<string, string> = {
    "english": "en", "japanese": "ja", "chinese": "zh", "spanish": "es",
    "french": "fr", "german": "de", "portuguese": "pt", "russian": "ru",
    "italian": "it", "arabic": "ar", "hindi": "hi", "thai": "th",
    "vietnamese": "vi", "indonesian": "id", "turkish": "tr", "dutch": "nl",
    "korean": "ko", "malay": "ms", "polish": "pl", "swedish": "sv",
  };
  const lower = cleaned.toLowerCase();
  for (const [name, code] of Object.entries(englishNames)) {
    if (lower.includes(name)) {
      return findLanguageByCode(code);
    }
  }

  // 4. 원문에서 키워드 재시도 (조사 포함 텍스트)
  const langKeywords = [
    "일본어", "영어", "중국어", "스페인어", "프랑스어", "독일어",
    "포르투갈어", "러시아어", "이탈리아어", "아랍어", "힌디어",
    "태국어", "베트남어", "인도네시아어", "터키어", "네덜란드어",
    "폴란드어", "스웨덴어", "일어", "불어", "독어", "노어", "중어",
    "타이어", "말레이어", "필리핀어", "우크라이나어",
  ];
  for (const kw of langKeywords) {
    if (message.includes(kw)) {
      return findLanguageByKeyword(kw);
    }
  }

  return undefined;
}

// ==================== 통역 의도 감지 (광범위) ====================

/**
 * 메시지가 "통역해줘"라는 의미를 담고 있는지 광범위하게 감지
 *
 * "통역", "번역", "통역해줘", "번역 좀", "말 좀 통역해", "대화 통역",
 * "실시간 통역", "음성 통역", "통역 부탁", "interpret", "translate" 등
 * 모든 가능한 표현을 잡아냄
 */
export function isTranslationIntent(message: string): boolean {
  // 이미 다른 명령어 형태인 경우 (별도 처리)
  if (/^\//.test(message)) return false;

  return /통역|음성\s*번역|실시간\s*번역|동시\s*통역|interpret|translate/i.test(message);
}

/**
 * 메시지가 통역 시작 의도인지 (번역 요청이 아닌, 세션 시작 의도)
 * "통역해줘", "통역 시작해", "통역 켜줘" 등 → 세션 시작
 * "번역해줘 이 문장" → 텍스트 번역 (세션 아님)
 */
export function isLiveTranslationIntent(message: string): boolean {
  // "통역" 계열은 거의 항상 라이브 세션 의도
  if (/통역/.test(message)) return true;

  // "음성 번역", "실시간 번역" → 라이브 세션
  if (/음성\s*번역|실시간\s*번역|동시\s*번역/.test(message)) return true;

  // "번역" 단독은 텍스트 번역일 수 있으므로 false
  return false;
}
