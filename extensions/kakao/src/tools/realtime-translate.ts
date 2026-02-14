/**
 * 실시간 번역 Tool — 일본어↔한국어 특화
 *
 * 3-Tier 번역 파이프라인:
 *
 * Tier 1: 텍스트 번역 (채팅 메시지)
 *   - Papago API (최고 JA↔KO 품질, 존댓말 처리)
 *   - DeepL API (폴백)
 *   - Google Translate API (최종 폴백)
 *
 * Tier 2: 음성 통역 (통화/대면)
 *   - Gemini 2.5 Flash Native Audio Live API (음성→음성 직접 변환)
 *   - WebSocket 양방향 스트리밍, 320~800ms 지연
 *   - 폴백: OpenAI Whisper STT → Papago → TTS
 *
 * Tier 3: 여행 도우미 모드
 *   - 자주 쓰는 여행 표현 즉석 번역
 *   - 상황별 회화 가이드 (식당, 교통, 호텔, 쇼핑, 긴급)
 *   - 발음 가이드 (로마지 + 한글 표기)
 *
 * 지원 언어쌍:
 * - 일본어 ↔ 한국어 (주력)
 * - 영어 ↔ 한국어
 * - 일본어 ↔ 영어
 * - 중국어 ↔ 한국어
 */

// ==================== Types ====================

export type TranslationDirection = "ja-ko" | "ko-ja" | "en-ko" | "ko-en" | "ja-en" | "en-ja" | "zh-ko" | "ko-zh";
export type HonorificsLevel = "formal" | "polite" | "casual";

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  direction: TranslationDirection;
  provider: "papago" | "deepl" | "google";
  /** Pronunciation guide (romanji/한글 표기) */
  pronunciation?: string;
  /** Detected source language (when auto-detected) */
  detectedLanguage?: string;
  /** Translation confidence (0-1) */
  confidence?: number;
  /** Latency in ms */
  latencyMs: number;
}

export interface VoiceTranslationResult {
  /** Recognized speech text (source language) */
  recognizedText: string;
  /** Translated text */
  translatedText: string;
  /** TTS audio URL (target language) */
  audioUrl?: string;
  direction: TranslationDirection;
  /** Total pipeline latency (STT + translation + TTS) */
  totalLatencyMs: number;
}

export interface TravelPhrase {
  category: string;
  korean: string;
  japanese: string;
  pronunciation: string;
  situation: string;
}

// ==================== Text Translation ====================

/**
 * 텍스트 번역 — 3단 폴백 (Papago → DeepL → Google)
 */
export async function translateText(
  text: string,
  options?: {
    direction?: TranslationDirection;
    honorifics?: HonorificsLevel;
    /** Auto-detect source language */
    autoDetect?: boolean;
  },
): Promise<TranslationResult> {
  const direction = options?.direction ?? detectDirection(text);
  const start = Date.now();

  // Try providers in order of JA-KO quality
  const providers = [
    { name: "papago" as const, fn: () => translateWithPapago(text, direction, options?.honorifics) },
    { name: "deepl" as const, fn: () => translateWithDeepL(text, direction) },
    { name: "google" as const, fn: () => translateWithGoogle(text, direction) },
  ];

  for (const { name, fn } of providers) {
    try {
      const translatedText = await fn();
      return {
        originalText: text,
        translatedText,
        direction,
        provider: name,
        pronunciation: generatePronunciation(translatedText, direction),
        latencyMs: Date.now() - start,
      };
    } catch {
      // Try next provider
    }
  }

  throw new Error("모든 번역 서비스를 사용할 수 없습니다. API 키를 확인해주세요.");
}

/**
 * Naver Papago API — 일본어↔한국어 최고 품질
 */
async function translateWithPapago(
  text: string,
  direction: TranslationDirection,
  honorifics?: HonorificsLevel,
): Promise<string> {
  const clientId = process.env.NAVER_CLIENT_ID ?? process.env.PAPAGO_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET ?? process.env.PAPAGO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Papago API 키 미설정");
  }

  const [source, target] = parseLangPair(direction);

  const body: Record<string, string> = {
    source,
    target,
    text,
  };

  // Papago 존댓말 옵션 (KO 출력 시)
  if (target === "ko" && honorifics) {
    body.honorific = honorifics === "formal" ? "true" : "false";
  }

  const response = await fetch("https://openapi.naver.com/v1/papago/n2mt", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Papago 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.message?.result?.translatedText ?? "";
}

/**
 * DeepL API — 고품질 폴백
 */
async function translateWithDeepL(
  text: string,
  direction: TranslationDirection,
): Promise<string> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) throw new Error("DeepL API 키 미설정");

  const [, target] = parseLangPair(direction);

  // DeepL uses uppercase language codes
  const deeplTargetMap: Record<string, string> = {
    ko: "KO",
    ja: "JA",
    en: "EN",
    zh: "ZH",
  };

  const response = await fetch("https://api-free.deepl.com/v2/translate", {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      target_lang: deeplTargetMap[target] ?? target.toUpperCase(),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepL 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.translations?.[0]?.text ?? "";
}

/**
 * Google Cloud Translation API — 최종 폴백
 */
async function translateWithGoogle(
  text: string,
  direction: TranslationDirection,
): Promise<string> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Google Translate API 키 미설정");

  const [source, target] = parseLangPair(direction);

  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source,
      target,
      format: "text",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Translate 오류: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.data?.translations?.[0]?.translatedText ?? "";
}

// ==================== Voice Translation (Gemini Live API 기반) ====================

// Re-export Gemini Live API for direct session control
export {
  GeminiLiveTranslator,
  createCallTranslationSession,
  translateAudioClip,
  formatSessionStatus,
  formatLiveTranslateGuide,
  type TranslationMode,
  type VoiceName,
  type LiveSessionConfig,
} from "./gemini-live-translate.js";

/**
 * 음성 번역 — Gemini Live API 우선, 레거시 폴백
 *
 * 우선순위:
 * 1. Gemini 2.5 Flash Native Audio (음성→음성 직접, 320~800ms)
 * 2. Legacy: Whisper STT → Papago → OpenAI TTS (~2000ms)
 */
export async function translateVoice(params: {
  /** Base64 encoded audio data (PCM 16kHz for Gemini, any format for legacy) */
  audioBase64: string;
  /** Audio format (legacy only — Gemini expects PCM 16kHz) */
  audioFormat?: "wav" | "mp3" | "webm" | "ogg" | "pcm";
  /** Translation direction */
  direction?: TranslationDirection;
}): Promise<VoiceTranslationResult> {
  const direction = params.direction ?? "ja-ko";

  // Tier 1: Gemini Live API (Native Audio — 최고 성능)
  const geminiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const { translateAudioClip: geminiTranslate } = await import("./gemini-live-translate.js");
      const geminiMode = directionToGeminiMode(direction);
      const result = await geminiTranslate({
        audioBase64: params.audioBase64,
        mode: geminiMode,
        voice: "Kore",
      });

      return {
        recognizedText: result.transcriptText || "(Gemini 네이티브 오디오)",
        translatedText: result.transcriptText,
        audioUrl: result.translatedAudioBase64
          ? `data:audio/pcm;rate=24000;base64,${result.translatedAudioBase64}`
          : undefined,
        direction,
        totalLatencyMs: result.latencyMs,
      };
    } catch (err) {
      console.warn("Gemini Live API 폴백:", err);
      // Fall through to legacy pipeline
    }
  }

  // Tier 2: Legacy pipeline (Whisper + Papago + OpenAI TTS)
  return translateVoiceLegacy(params);
}

/**
 * TranslationDirection → Gemini TranslationMode 변환
 */
function directionToGeminiMode(direction: TranslationDirection): "ja-to-ko" | "ko-to-ja" | "bidirectional" {
  switch (direction) {
    case "ja-ko": return "ja-to-ko";
    case "ko-ja": return "ko-to-ja";
    default: return "bidirectional";
  }
}

/**
 * 레거시 음성 번역 파이프라인: Whisper STT → Papago → OpenAI TTS
 * Gemini API 키가 없을 때 폴백으로 사용
 */
async function translateVoiceLegacy(params: {
  audioBase64: string;
  audioFormat?: "wav" | "mp3" | "webm" | "ogg" | "pcm";
  direction?: TranslationDirection;
}): Promise<VoiceTranslationResult> {
  const start = Date.now();
  const direction = params.direction ?? "ja-ko";
  const [sourceLang] = parseLangPair(direction);

  // Step 1: STT
  const recognizedText = await speechToText(
    params.audioBase64,
    sourceLang,
    params.audioFormat ?? "wav",
  );

  // Step 2: Translation
  const translationResult = await translateText(recognizedText, { direction });

  // Step 3: TTS
  const audioUrl = await textToSpeech(
    translationResult.translatedText,
    direction.split("-")[1],
  );

  return {
    recognizedText,
    translatedText: translationResult.translatedText,
    audioUrl,
    direction,
    totalLatencyMs: Date.now() - start,
  };
}

/**
 * Speech-to-Text (OpenAI Whisper / Deepgram)
 */
async function speechToText(
  audioBase64: string,
  language: string,
  format: string,
): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return sttWithWhisper(audioBase64, language, format, openaiKey);
  }

  const deepgramKey = process.env.DEEPGRAM_API_KEY;
  if (deepgramKey) {
    return sttWithDeepgram(audioBase64, language, format, deepgramKey);
  }

  throw new Error("STT API 키가 설정되지 않았습니다 (OPENAI_API_KEY 또는 DEEPGRAM_API_KEY)");
}

async function sttWithWhisper(
  audioBase64: string,
  language: string,
  format: string,
  apiKey: string,
): Promise<string> {
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const blob = new Blob([audioBuffer], { type: `audio/${format}` });

  const formData = new FormData();
  formData.append("file", blob, `audio.${format}`);
  formData.append("model", "whisper-1");
  formData.append("language", language);
  formData.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Whisper STT 오류: ${response.status}`);
  }

  const data = await response.json();
  return data.text ?? "";
}

async function sttWithDeepgram(
  audioBase64: string,
  language: string,
  format: string,
  apiKey: string,
): Promise<string> {
  const langMap: Record<string, string> = { ja: "ja", ko: "ko", en: "en", zh: "zh" };
  const audioBuffer = Buffer.from(audioBase64, "base64");

  const response = await fetch(
    `https://api.deepgram.com/v1/listen?language=${langMap[language] ?? language}&model=nova-3`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": `audio/${format}`,
      },
      body: audioBuffer,
    },
  );

  if (!response.ok) {
    throw new Error(`Deepgram STT 오류: ${response.status}`);
  }

  const data = await response.json();
  return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
}

/**
 * Text-to-Speech (OpenAI TTS, 레거시 폴백용)
 */
async function textToSpeech(
  text: string,
  targetLanguage: string,
): Promise<string | undefined> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return undefined;

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      input: text,
      voice: targetLanguage === "ko" ? "nova" : targetLanguage === "ja" ? "shimmer" : "alloy",
      response_format: "mp3",
      speed: 1.0,
    }),
  });

  if (!response.ok) return undefined;

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:audio/mp3;base64,${base64}`;
}

// ==================== 여행 도우미 모드 ====================

/** 상황별 자주 쓰는 여행 일본어 표현 */
const TRAVEL_PHRASES: TravelPhrase[] = [
  // 기본 인사
  { category: "인사", korean: "안녕하세요", japanese: "こんにちは", pronunciation: "곤니치와", situation: "낮 인사" },
  { category: "인사", korean: "감사합니다", japanese: "ありがとうございます", pronunciation: "아리가토 고자이마스", situation: "감사 표현" },
  { category: "인사", korean: "실례합니다", japanese: "すみません", pronunciation: "스미마셍", situation: "말 걸기/사과" },
  { category: "인사", korean: "괜찮습니다", japanese: "大丈夫です", pronunciation: "다이죠부데스", situation: "괜찮다고 할 때" },

  // 식당
  { category: "식당", korean: "메뉴 주세요", japanese: "メニューをください", pronunciation: "메뉴오 쿠다사이", situation: "메뉴 요청" },
  { category: "식당", korean: "이거 주세요", japanese: "これをください", pronunciation: "코레오 쿠다사이", situation: "주문" },
  { category: "식당", korean: "맛있습니다", japanese: "美味しいです", pronunciation: "오이시이데스", situation: "맛 칭찬" },
  { category: "식당", korean: "계산해 주세요", japanese: "お会計お願いします", pronunciation: "오카이케 오네가이시마스", situation: "계산 요청" },
  { category: "식당", korean: "알레르기가 있습니다", japanese: "アレルギーがあります", pronunciation: "아레루기가 아리마스", situation: "알레르기 알림" },
  { category: "식당", korean: "예약했습니다", japanese: "予約しています", pronunciation: "요야쿠 시테이마스", situation: "예약 확인" },
  { category: "식당", korean: "2명입니다", japanese: "二人です", pronunciation: "후타리데스", situation: "인원 수" },

  // 교통
  { category: "교통", korean: "이 전철은 어디로 가나요?", japanese: "この電車はどこに行きますか？", pronunciation: "코노 덴샤와 도코니 이키마스카?", situation: "전철 행선지" },
  { category: "교통", korean: "○○역까지 얼마인가요?", japanese: "○○駅までいくらですか？", pronunciation: "○○에키마데 이쿠라데스카?", situation: "요금 확인" },
  { category: "교통", korean: "택시 타고 싶어요", japanese: "タクシーに乗りたいです", pronunciation: "타쿠시니 노리타이데스", situation: "택시 요청" },
  { category: "교통", korean: "여기서 내려주세요", japanese: "ここで降ろしてください", pronunciation: "코코데 오로시테 쿠다사이", situation: "택시 하차" },
  { category: "교통", korean: "Suica 충전해 주세요", japanese: "Suicaにチャージしてください", pronunciation: "스이카니 챠지 시테쿠다사이", situation: "교통카드 충전" },

  // 쇼핑
  { category: "쇼핑", korean: "이거 얼마인가요?", japanese: "これはいくらですか？", pronunciation: "코레와 이쿠라데스카?", situation: "가격 문의" },
  { category: "쇼핑", korean: "면세 되나요?", japanese: "免税できますか？", pronunciation: "멘제이 데키마스카?", situation: "면세 문의" },
  { category: "쇼핑", korean: "다른 색상 있나요?", japanese: "他の色はありますか？", pronunciation: "호카노 이로와 아리마스카?", situation: "색상 문의" },
  { category: "쇼핑", korean: "카드 결제 되나요?", japanese: "カードで払えますか？", pronunciation: "카도데 하라에마스카?", situation: "결제 수단" },

  // 호텔
  { category: "호텔", korean: "체크인 해주세요", japanese: "チェックインお願いします", pronunciation: "체크인 오네가이시마스", situation: "체크인" },
  { category: "호텔", korean: "Wi-Fi 비밀번호가 뭔가요?", japanese: "Wi-Fiのパスワードは何ですか？", pronunciation: "와이파이노 파스와도와 난데스카?", situation: "Wi-Fi 문의" },
  { category: "호텔", korean: "짐 맡아주세요", japanese: "荷物を預けてもいいですか？", pronunciation: "니모츠오 아즈케테모 이이데스카?", situation: "짐 보관" },

  // 긴급
  { category: "긴급", korean: "도와주세요!", japanese: "助けてください！", pronunciation: "타스케테 쿠다사이!", situation: "도움 요청" },
  { category: "긴급", korean: "경찰 불러주세요", japanese: "警察を呼んでください", pronunciation: "케이사츠오 욘데 쿠다사이", situation: "경찰 호출" },
  { category: "긴급", korean: "병원이 어디인가요?", japanese: "病院はどこですか？", pronunciation: "뵤인와 도코데스카?", situation: "병원 위치" },
  { category: "긴급", korean: "길을 잃었습니다", japanese: "道に迷いました", pronunciation: "미치니 마요이마시타", situation: "길을 잃었을 때" },
  { category: "긴급", korean: "한국어 되시는 분?", japanese: "韓国語ができる方はいますか？", pronunciation: "칸코쿠고가 데키루 카타와 이마스카?", situation: "한국어 가능자 확인" },

  // 관광
  { category: "관광", korean: "사진 찍어주세요", japanese: "写真を撮ってもらえますか？", pronunciation: "샤신오 톳테 모라에마스카?", situation: "사진 부탁" },
  { category: "관광", korean: "화장실 어디인가요?", japanese: "トイレはどこですか？", pronunciation: "토이레와 도코데스카?", situation: "화장실 위치" },
  { category: "관광", korean: "입장료가 얼마인가요?", japanese: "入場料はいくらですか？", pronunciation: "뉴죠료와 이쿠라데스카?", situation: "입장료 확인" },
];

/**
 * 여행 표현 검색 (카테고리/키워드)
 */
export function searchTravelPhrases(query: string): TravelPhrase[] {
  const lower = query.toLowerCase();

  // 카테고리 검색
  const categoryMatch = TRAVEL_PHRASES.filter(
    (p) => p.category === query || p.situation.includes(query),
  );
  if (categoryMatch.length > 0) return categoryMatch;

  // 키워드 검색
  return TRAVEL_PHRASES.filter(
    (p) =>
      p.korean.includes(lower) ||
      p.japanese.includes(lower) ||
      p.situation.includes(lower) ||
      p.category.includes(lower),
  );
}

/**
 * 카테고리별 여행 표현 가져오기
 */
export function getTravelPhrasesByCategory(category: string): TravelPhrase[] {
  return TRAVEL_PHRASES.filter((p) => p.category === category);
}

/**
 * 사용 가능한 카테고리 목록
 */
export function getTravelCategories(): string[] {
  return [...new Set(TRAVEL_PHRASES.map((p) => p.category))];
}

// ==================== 포맷터 ====================

/**
 * 번역 결과 → 메시지
 */
export function formatTranslationMessage(result: TranslationResult): string {
  const directionLabel: Record<TranslationDirection, string> = {
    "ja-ko": "🇯🇵→🇰🇷",
    "ko-ja": "🇰🇷→🇯🇵",
    "en-ko": "🇺🇸→🇰🇷",
    "ko-en": "🇰🇷→🇺🇸",
    "ja-en": "🇯🇵→🇺🇸",
    "en-ja": "🇺🇸→🇯🇵",
    "zh-ko": "🇨🇳→🇰🇷",
    "ko-zh": "🇰🇷→🇨🇳",
  };

  const providerLabel: Record<string, string> = {
    papago: "Papago",
    deepl: "DeepL",
    google: "Google",
  };

  const lines = [
    `${directionLabel[result.direction] ?? "🌐"} 번역 결과`,
    "",
    `📝 원문: ${result.originalText}`,
    `📖 번역: ${result.translatedText}`,
  ];

  if (result.pronunciation) {
    lines.push(`🗣️ 발음: ${result.pronunciation}`);
  }

  lines.push(`⚡ ${result.latencyMs}ms · ${providerLabel[result.provider] ?? result.provider}`);

  return lines.join("\n");
}

/**
 * 음성 번역 결과 → 메시지
 */
export function formatVoiceTranslationMessage(result: VoiceTranslationResult): string {
  const lines = [
    "🎙️ 음성 통역 결과",
    "",
    `🗣️ 인식: ${result.recognizedText}`,
    `📖 번역: ${result.translatedText}`,
  ];

  if (result.audioUrl) {
    lines.push(`🔊 음성: [재생]`);
  }

  lines.push(`⚡ ${result.totalLatencyMs}ms`);

  return lines.join("\n");
}

/**
 * 여행 표현 → 메시지
 */
export function formatTravelPhrases(phrases: TravelPhrase[], category?: string): string {
  if (phrases.length === 0) {
    return "해당하는 여행 표현을 찾을 수 없습니다.";
  }

  const title = category
    ? `🇯🇵 일본 여행 표현 — ${category}`
    : "🇯🇵 일본 여행 표현";

  const lines = [title, ""];

  for (const phrase of phrases) {
    lines.push(`💬 ${phrase.korean}`);
    lines.push(`   → ${phrase.japanese}`);
    lines.push(`   🗣️ ${phrase.pronunciation}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 전체 여행 도우미 메뉴
 */
export function formatTravelHelp(): string {
  const categories = getTravelCategories();
  const categoryIcons: Record<string, string> = {
    인사: "👋",
    식당: "🍱",
    교통: "🚃",
    쇼핑: "🛍️",
    호텔: "🏨",
    긴급: "🚨",
    관광: "📸",
  };

  return [
    "🇯🇵 일본 여행 통역 도우미",
    "",
    "━━ 실시간 통역 (Gemini 2.5 Flash) ━━",
    "/통역시작              — 양방향 실시간 통역 시작",
    "/통역시작 일→한        — 일본어→한국어 모드",
    "/통역시작 한→일        — 한국어→일본어 모드",
    "/전화통역              — 전화 통화 양방향 통역",
    "/통역시작 식당          — 식당 맥락 통역",
    "⚡ 지연: 320~800ms | 네이티브 음성→음성",
    "",
    "━━ 텍스트 번역 ━━",
    "/번역 [일본어 또는 한국어]  — 즉석 번역",
    "",
    "━━ 상황별 회화 ━━",
    ...categories.map(
      (c) => `/여행표현 ${c}  ${categoryIcons[c] ?? "📋"} — ${c} 관련 필수 표현`,
    ),
    "",
    "━━ 사용 예시 ━━",
    "/번역 이 전철은 도쿄역에 가나요?",
    "/번역 すみません、トイレはどこですか？",
    "/여행표현 식당",
    "/통역시작 쇼핑",
    "",
    "💡 텍스트를 입력하면 자동으로 언어를 감지하여 번역합니다.",
    "📞 실시간 통역은 /통역시작 으로 시작하세요 (Gemini Live API).",
  ].join("\n");
}

// ==================== 요청 감지 ====================

/**
 * 번역 관련 요청 감지
 */
export function detectTranslationRequest(message: string): {
  type: "translate" | "voice_translate" | "live_translate" | "travel_phrases" | "travel_help" | null;
  text: string;
  direction?: TranslationDirection;
  category?: string;
  /** Gemini Live 세션 맥락 (식당, 교통, 쇼핑, 긴급 등) */
  liveContext?: string;
} {
  // Gemini Live 실시간 통역 명령
  if (/^\/통역시작/.test(message)) {
    const arg = message.replace(/^\/통역시작\s*/, "").trim();
    let direction: TranslationDirection | undefined;
    let liveContext: string | undefined;

    if (/일.*한|ja.*ko/i.test(arg)) direction = "ja-ko";
    else if (/한.*일|ko.*ja/i.test(arg)) direction = "ko-ja";

    // 맥락 감지
    if (/식당|레스토랑|음식/.test(arg)) liveContext = "식당에서 주문 및 식사";
    else if (/교통|택시|전철|지하철/.test(arg)) liveContext = "교통수단 이용 및 이동";
    else if (/쇼핑|가게|면세/.test(arg)) liveContext = "쇼핑 및 구매";
    else if (/긴급|응급|경찰|병원/.test(arg)) liveContext = "긴급 상황 대응";
    else if (/호텔|숙소|체크인/.test(arg)) liveContext = "호텔 및 숙박";

    return { type: "live_translate", text: message, direction, liveContext };
  }

  // 전화 통역 (양방향 자동 감지)
  if (/^\/전화통역/.test(message)) {
    return { type: "live_translate", text: message, liveContext: "전화 통화 통역" };
  }

  // 통역 세션 관리
  if (/^\/통역종료|^\/통역상태/.test(message)) {
    return { type: "live_translate", text: message };
  }

  // 명시적 번역 명령
  if (/^\/번역\s+/.test(message)) {
    const text = message.replace(/^\/번역\s+/, "").trim();
    return { type: "translate", text, direction: detectDirection(text) };
  }

  // 음성 번역 명령
  if (/^\/음성번역/.test(message)) {
    return { type: "voice_translate", text: message };
  }

  // 여행 표현 명령
  if (/^\/여행표현\s*(.*)/.test(message)) {
    const match = message.match(/^\/여행표현\s*(.*)/);
    const category = match?.[1]?.trim();
    return {
      type: category ? "travel_phrases" : "travel_help",
      text: message,
      category,
    };
  }

  // 여행 도우미 메뉴
  if (/^\/여행도우미|^\/여행통역|^\/일본어/.test(message)) {
    return { type: "travel_help", text: message };
  }

  // 실시간 통역 요청 (자연어)
  if (/실시간.*(통역|번역)|전화.*(통역|번역)/.test(message)) {
    return { type: "live_translate", text: message };
  }

  // 암시적 번역 요청 (일본어 텍스트가 포함된 경우)
  if (/번역|통역|뭐라고|무슨\s*뜻|일본어로|한국어로/.test(message)) {
    const text = message
      .replace(/번역|통역|해줘|해\s*줘|알려줘|뭐라고|무슨\s*뜻/g, "")
      .replace(/일본어로|한국어로|영어로/g, "")
      .trim();

    let direction: TranslationDirection | undefined;
    if (/일본어로/.test(message)) direction = "ko-ja";
    if (/한국어로/.test(message)) direction = "ja-ko";
    if (/영어로/.test(message)) direction = "ko-en";

    return { type: "translate", text: text || message, direction };
  }

  return { type: null, text: message };
}

// ==================== 내부 헬퍼 ====================

/**
 * 텍스트 언어 자동 감지 → 번역 방향 결정
 */
function detectDirection(text: string): TranslationDirection {
  // 일본어 문자 감지 (히라가나, 가타카나, 한자)
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF]/.test(text);
  // 한국어 감지
  const hasKorean = /[가-힣]/.test(text);
  // 영어 감지
  const hasEnglish = /[a-zA-Z]{3,}/.test(text);
  // 중국어 감지 (일본어와 구분: 히라가나/가타카나 없이 한자만)
  const hasChinese = /[\u4E00-\u9FFF]/.test(text) && !hasJapanese;

  if (hasJapanese && !hasKorean) return "ja-ko";
  if (hasKorean && !hasJapanese) return "ko-ja";
  if (hasEnglish && !hasKorean && !hasJapanese) return "en-ko";
  if (hasChinese) return "zh-ko";

  // 기본: 일본어→한국어
  return "ja-ko";
}

/**
 * 번역 방향 → [소스언어, 타겟언어]
 */
function parseLangPair(direction: TranslationDirection): [string, string] {
  const [source, target] = direction.split("-");
  return [source, target];
}

/**
 * 발음 가이드 생성
 */
function generatePronunciation(
  text: string,
  direction: TranslationDirection,
): string | undefined {
  const targetLang = direction.split("-")[1];

  // 일본어 출력에 대해 한글 발음 가이드 제공
  if (targetLang === "ja") {
    return japaneseToKoreanPronunciation(text);
  }

  return undefined;
}

/**
 * 일본어 → 한글 발음 변환 (기본 히라가나/가타카나)
 */
function japaneseToKoreanPronunciation(text: string): string {
  const hiraganaMap: Record<string, string> = {
    あ: "아", い: "이", う: "우", え: "에", お: "오",
    か: "카", き: "키", く: "쿠", け: "케", こ: "코",
    さ: "사", し: "시", す: "스", せ: "세", そ: "소",
    た: "타", ち: "치", つ: "츠", て: "테", と: "토",
    な: "나", に: "니", ぬ: "누", ね: "네", の: "노",
    は: "하", ひ: "히", ふ: "후", へ: "헤", ほ: "호",
    ま: "마", み: "미", む: "무", め: "메", も: "모",
    や: "야", ゆ: "유", よ: "요",
    ら: "라", り: "리", る: "루", れ: "레", ろ: "로",
    わ: "와", を: "오", ん: "응",
    が: "가", ぎ: "기", ぐ: "구", げ: "게", ご: "고",
    ざ: "자", じ: "지", ず: "즈", ぜ: "제", ぞ: "조",
    だ: "다", ぢ: "지", づ: "즈", で: "데", ど: "도",
    ば: "바", び: "비", ぶ: "부", べ: "베", ぼ: "보",
    ぱ: "파", ぴ: "피", ぷ: "푸", ぺ: "페", ぽ: "포",
  };

  // Convert katakana to hiragana range for lookup, then map
  let result = "";
  for (const char of text) {
    // Katakana to hiragana conversion (U+30A0 → U+3040)
    let lookupChar = char;
    const code = char.charCodeAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) {
      lookupChar = String.fromCharCode(code - 0x60);
    }

    const mapped = hiraganaMap[lookupChar];
    result += mapped ?? char;
  }

  return result;
}
