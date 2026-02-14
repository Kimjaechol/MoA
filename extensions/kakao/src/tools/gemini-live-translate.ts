/**
 * Gemini Live API — 실시간 음성 통역 엔진
 *
 * Google Gemini 2.5 Flash Native Audio를 사용한 초저지연 음성↔음성 번역.
 * 기존 STT→번역→TTS 파이프라인 대비 2~3배 빠른 응답 (320~800ms).
 *
 * 아키텍처:
 * - WebSocket 양방향 스트리밍 (BidiGenerateContent)
 * - 네이티브 오디오 처리 (별도 STT/TTS 없이 직접 음성→음성)
 * - 자동 음성 활동 감지 (VAD)
 * - 세션 이어하기 (네트워크 끊김 시 자동 복구)
 * - 컨텍스트 윈도우 압축 (무제한 세션)
 *
 * 비용: 오디오 입력 ~$0.0015/분, 출력 ~$0.00375/분
 * (25 토큰/초 × $1.00/$2.50 per 1M tokens)
 */

import { EventEmitter } from "events";

// ==================== Types ====================

const GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025";
const GEMINI_WS_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/**
 * TranslationMode: "소스-to-타겟" 형태 또는 "bidirectional:소스:타겟"
 * 예: "ja-to-ko", "en-to-ko", "bidirectional:ja:ko", "bidirectional:zh:ko"
 */
export type TranslationMode = string;

export type VoiceName =
  | "Kore"     // 따뜻한 여성 음성
  | "Aoede"    // 차분한 여성 음성
  | "Puck"     // 기본 남성 음성
  | "Charon"   // 깊은 남성 음성
  | "Fenrir"   // 밝은 남성 음성
  | "Leda"     // 부드러운 여성 음성
  | "Orus"     // 성숙한 남성 음성
  | "Zephyr";  // 경쾌한 음성

export interface LiveSessionConfig {
  /** 번역 모드 (예: "ja-to-ko", "en-to-ko", "bidirectional:ja:ko") */
  mode: TranslationMode;
  /** 출력 음성 (기본: Kore) */
  voice?: VoiceName;
  /** 존댓말 사용 (기본: true) */
  formal?: boolean;
  /** 문맥 힌트 (여행, 비즈니스, 의료 등) */
  context?: string;
  /** 세션 이어하기 활성화 (기본: true) */
  enableResumption?: boolean;
  /** 무제한 세션을 위한 컨텍스트 압축 (기본: true) */
  enableCompression?: boolean;
}

// ==================== 언어 레지스트리 ====================

export interface LanguageInfo {
  /** ISO 639-1 코드 (예: "ja", "en") */
  code: string;
  /** BCP-47 로케일 (예: "ja-JP", "en-US") */
  locale: string;
  /** 한국어 이름 */
  nameKo: string;
  /** 원어 이름 */
  nameNative: string;
  /** 국기 이모지 */
  flag: string;
  /** 한국어에서 사용하는 키워드 (의도 감지용) */
  keywords: string[];
}

/**
 * Gemini Live API가 지원하는 전체 언어 목록
 * https://ai.google.dev/gemini-api/docs/live#supported-languages
 */
export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { code: "ko", locale: "ko-KR", nameKo: "한국어", nameNative: "한국어", flag: "🇰🇷", keywords: ["한국어", "한국", "korean"] },
  { code: "ja", locale: "ja-JP", nameKo: "일본어", nameNative: "日本語", flag: "🇯🇵", keywords: ["일본어", "일본", "일어", "japanese"] },
  { code: "en", locale: "en-US", nameKo: "영어", nameNative: "English", flag: "🇺🇸", keywords: ["영어", "영국어", "미국어", "english"] },
  { code: "zh", locale: "zh-CN", nameKo: "중국어", nameNative: "中文", flag: "🇨🇳", keywords: ["중국어", "중국", "chinese", "중어"] },
  { code: "es", locale: "es-ES", nameKo: "스페인어", nameNative: "Español", flag: "🇪🇸", keywords: ["스페인어", "스페인", "spanish"] },
  { code: "fr", locale: "fr-FR", nameKo: "프랑스어", nameNative: "Français", flag: "🇫🇷", keywords: ["프랑스어", "프랑스", "french", "불어"] },
  { code: "de", locale: "de-DE", nameKo: "독일어", nameNative: "Deutsch", flag: "🇩🇪", keywords: ["독일어", "독일", "german", "독어"] },
  { code: "pt", locale: "pt-BR", nameKo: "포르투갈어", nameNative: "Português", flag: "🇧🇷", keywords: ["포르투갈어", "포르투갈", "브라질", "portuguese"] },
  { code: "ru", locale: "ru-RU", nameKo: "러시아어", nameNative: "Русский", flag: "🇷🇺", keywords: ["러시아어", "러시아", "russian", "노어"] },
  { code: "it", locale: "it-IT", nameKo: "이탈리아어", nameNative: "Italiano", flag: "🇮🇹", keywords: ["이탈리아어", "이탈리아", "italian"] },
  { code: "ar", locale: "ar-SA", nameKo: "아랍어", nameNative: "العربية", flag: "🇸🇦", keywords: ["아랍어", "아랍", "arabic"] },
  { code: "hi", locale: "hi-IN", nameKo: "힌디어", nameNative: "हिन्दी", flag: "🇮🇳", keywords: ["힌디어", "힌디", "인도어", "hindi"] },
  { code: "th", locale: "th-TH", nameKo: "태국어", nameNative: "ภาษาไทย", flag: "🇹🇭", keywords: ["태국어", "태국", "타이어", "thai"] },
  { code: "vi", locale: "vi-VN", nameKo: "베트남어", nameNative: "Tiếng Việt", flag: "🇻🇳", keywords: ["베트남어", "베트남", "vietnamese"] },
  { code: "id", locale: "id-ID", nameKo: "인도네시아어", nameNative: "Bahasa Indonesia", flag: "🇮🇩", keywords: ["인도네시아어", "인도네시아", "indonesian"] },
  { code: "ms", locale: "ms-MY", nameKo: "말레이어", nameNative: "Bahasa Melayu", flag: "🇲🇾", keywords: ["말레이어", "말레이시아", "malay"] },
  { code: "tr", locale: "tr-TR", nameKo: "터키어", nameNative: "Türkçe", flag: "🇹🇷", keywords: ["터키어", "터키", "turkish"] },
  { code: "nl", locale: "nl-NL", nameKo: "네덜란드어", nameNative: "Nederlands", flag: "🇳🇱", keywords: ["네덜란드어", "네덜란드", "dutch"] },
  { code: "pl", locale: "pl-PL", nameKo: "폴란드어", nameNative: "Polski", flag: "🇵🇱", keywords: ["폴란드어", "폴란드", "polish"] },
  { code: "sv", locale: "sv-SE", nameKo: "스웨덴어", nameNative: "Svenska", flag: "🇸🇪", keywords: ["스웨덴어", "스웨덴", "swedish"] },
  { code: "da", locale: "da-DK", nameKo: "덴마크어", nameNative: "Dansk", flag: "🇩🇰", keywords: ["덴마크어", "덴마크", "danish"] },
  { code: "no", locale: "no-NO", nameKo: "노르웨이어", nameNative: "Norsk", flag: "🇳🇴", keywords: ["노르웨이어", "노르웨이", "norwegian"] },
  { code: "fi", locale: "fi-FI", nameKo: "핀란드어", nameNative: "Suomi", flag: "🇫🇮", keywords: ["핀란드어", "핀란드", "finnish"] },
  { code: "el", locale: "el-GR", nameKo: "그리스어", nameNative: "Ελληνικά", flag: "🇬🇷", keywords: ["그리스어", "그리스", "greek"] },
  { code: "cs", locale: "cs-CZ", nameKo: "체코어", nameNative: "Čeština", flag: "🇨🇿", keywords: ["체코어", "체코", "czech"] },
  { code: "ro", locale: "ro-RO", nameKo: "루마니아어", nameNative: "Română", flag: "🇷🇴", keywords: ["루마니아어", "루마니아", "romanian"] },
  { code: "hu", locale: "hu-HU", nameKo: "헝가리어", nameNative: "Magyar", flag: "🇭🇺", keywords: ["헝가리어", "헝가리", "hungarian"] },
  { code: "uk", locale: "uk-UA", nameKo: "우크라이나어", nameNative: "Українська", flag: "🇺🇦", keywords: ["우크라이나어", "우크라이나", "ukrainian"] },
  { code: "he", locale: "he-IL", nameKo: "히브리어", nameNative: "עברית", flag: "🇮🇱", keywords: ["히브리어", "이스라엘", "hebrew"] },
  { code: "bn", locale: "bn-BD", nameKo: "벵골어", nameNative: "বাংলা", flag: "🇧🇩", keywords: ["벵골어", "방글라데시", "bengali"] },
  { code: "ta", locale: "ta-IN", nameKo: "타밀어", nameNative: "தமிழ்", flag: "🇮🇳", keywords: ["타밀어", "tamil"] },
  { code: "te", locale: "te-IN", nameKo: "텔루구어", nameNative: "తెలుగు", flag: "🇮🇳", keywords: ["텔루구어", "telugu"] },
  { code: "ml", locale: "ml-IN", nameKo: "말라얄람어", nameNative: "മലയാളം", flag: "🇮🇳", keywords: ["말라얄람어", "malayalam"] },
  { code: "tl", locale: "tl-PH", nameKo: "필리핀어", nameNative: "Filipino", flag: "🇵🇭", keywords: ["필리핀어", "필리핀", "타갈로그", "filipino"] },
  { code: "sw", locale: "sw-KE", nameKo: "스와힐리어", nameNative: "Kiswahili", flag: "🇰🇪", keywords: ["스와힐리어", "swahili"] },
  { code: "bg", locale: "bg-BG", nameKo: "불가리아어", nameNative: "Български", flag: "🇧🇬", keywords: ["불가리아어", "불가리아", "bulgarian"] },
  { code: "hr", locale: "hr-HR", nameKo: "크로아티아어", nameNative: "Hrvatski", flag: "🇭🇷", keywords: ["크로아티아어", "크로아티아", "croatian"] },
  { code: "sk", locale: "sk-SK", nameKo: "슬로바키아어", nameNative: "Slovenčina", flag: "🇸🇰", keywords: ["슬로바키아어", "슬로바키아", "slovak"] },
  { code: "lt", locale: "lt-LT", nameKo: "리투아니아어", nameNative: "Lietuvių", flag: "🇱🇹", keywords: ["리투아니아어", "리투아니아", "lithuanian"] },
  { code: "lv", locale: "lv-LV", nameKo: "라트비아어", nameNative: "Latviešu", flag: "🇱🇻", keywords: ["라트비아어", "라트비아", "latvian"] },
  { code: "et", locale: "et-EE", nameKo: "에스토니아어", nameNative: "Eesti", flag: "🇪🇪", keywords: ["에스토니아어", "에스토니아", "estonian"] },
  { code: "ca", locale: "ca-ES", nameKo: "카탈루냐어", nameNative: "Català", flag: "🇪🇸", keywords: ["카탈루냐어", "catalan"] },
  { code: "sr", locale: "sr-RS", nameKo: "세르비아어", nameNative: "Српски", flag: "🇷🇸", keywords: ["세르비아어", "세르비아", "serbian"] },
];

/**
 * 키워드로 언어 찾기 (한국어 이름/영어/코드)
 */
export function findLanguageByKeyword(keyword: string): LanguageInfo | undefined {
  const lower = keyword.toLowerCase().trim();
  return SUPPORTED_LANGUAGES.find(
    (lang) =>
      lang.code === lower ||
      lang.keywords.some((kw) => kw === lower || lower.includes(kw) || kw.includes(lower)),
  );
}

/**
 * 언어 코드로 언어 찾기
 */
export function findLanguageByCode(code: string): LanguageInfo | undefined {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code);
}

/**
 * TranslationMode 파싱: 소스/타겟 언어코드와 양방향 여부 추출
 */
export function parseTranslationMode(mode: TranslationMode): {
  source: string;
  target: string;
  bidirectional: boolean;
} {
  // "bidirectional:ja:ko" 형태
  if (mode.startsWith("bidirectional")) {
    const parts = mode.split(":");
    return {
      source: parts[1] ?? "ja",
      target: parts[2] ?? "ko",
      bidirectional: true,
    };
  }
  // "ja-to-ko" 형태
  const match = mode.match(/^(\w+)-to-(\w+)$/);
  if (match) {
    return { source: match[1], target: match[2], bidirectional: false };
  }
  // 폴백: 양방향 일본어↔한국어
  return { source: "ja", target: "ko", bidirectional: true };
}

export interface LiveSessionEvents {
  /** 연결 성공 */
  connected: () => void;
  /** 번역된 오디오 수신 (PCM 24kHz 16-bit mono, base64) */
  audio: (audioBase64: string) => void;
  /** 번역된 텍스트 수신 (실시간 자막용) */
  transcript: (text: string, isFinal: boolean) => void;
  /** 사용자 음성 인식 텍스트 */
  userSpeech: (text: string) => void;
  /** 턴 완료 */
  turnComplete: () => void;
  /** 인터럽트 (사용자가 끼어듦) */
  interrupted: () => void;
  /** 오류 발생 */
  error: (error: Error) => void;
  /** 세션 종료 */
  closed: (reason: string) => void;
}

// ==================== System Instructions ====================

function buildSystemInstruction(config: LiveSessionConfig): string {
  const { source, target, bidirectional } = parseTranslationMode(config.mode);
  const sourceLang = findLanguageByCode(source);
  const targetLang = findLanguageByCode(target);

  const sourceName = sourceLang?.nameKo ?? source;
  const targetName = targetLang?.nameKo ?? target;

  const formalityNote = config.formal !== false
    ? "번역 시 항상 정중하고 공손한 표현을 사용하세요."
    : "번역 시 친근한 일상 표현을 사용하세요.";

  const contextNote = config.context
    ? `\n현재 상황: ${config.context}. 이 맥락에 맞는 적절한 용어와 표현을 사용하세요.`
    : "";

  if (bidirectional) {
    return [
      `당신은 ${sourceName}↔${targetName} 양방향 실시간 통역사입니다.`,
      `화자가 ${sourceName}로 말하면 ${targetName}로, ${targetName}로 말하면 ${sourceName}로 즉시 통역하세요.`,
      "언어를 자동으로 감지하여 반대 언어로 통역하세요.",
      formalityNote,
      "통역만 하세요. 설명이나 주석을 추가하지 마세요.",
      "고유명사(인명, 지명, 브랜드)는 원어 발음에 가깝게 표기하세요.",
      contextNote,
    ].filter(Boolean).join("\n");
  }

  // 단방향: 타겟 언어로 통역
  return [
    `당신은 전문 ${sourceName}→${targetName} 실시간 통역사입니다.`,
    `${sourceName} 음성을 듣고 즉시 자연스러운 ${targetName}로 통역하세요.`,
    formalityNote,
    "통역만 하세요. 설명이나 주석을 추가하지 마세요.",
    "고유명사(인명, 지명, 브랜드)는 원어 발음에 가깝게 표기하세요.",
    "숫자, 단위, 통화는 타겟 언어의 관습에 맞게 변환하세요.",
    contextNote,
  ].filter(Boolean).join("\n");
}

// ==================== Live Translation Session ====================

/**
 * Gemini Live API 기반 실시간 통역 세션
 *
 * 사용법:
 * ```ts
 * const session = new GeminiLiveTranslator({
 *   mode: "ja-to-ko",
 *   voice: "Kore",
 *   context: "일본 여행 중 식당 주문"
 * });
 *
 * session.on("audio", (audioBase64) => playAudio(audioBase64));
 * session.on("transcript", (text) => showSubtitle(text));
 *
 * await session.connect();
 * session.sendAudio(micPcmBase64); // 마이크 PCM 16kHz 스트리밍
 * ```
 */
export class GeminiLiveTranslator extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: LiveSessionConfig;
  private resumptionHandle: string | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;

  // 세션 통계
  private stats = {
    startTime: 0,
    audioChunksSent: 0,
    audioChunksReceived: 0,
    turnsCompleted: 0,
  };

  constructor(config: LiveSessionConfig) {
    super();
    this.config = {
      voice: "Kore",
      formal: true,
      enableResumption: true,
      enableCompression: true,
      ...config,
    };
  }

  /**
   * Gemini Live API에 WebSocket 연결
   */
  async connect(): Promise<void> {
    const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Google API 키가 설정되지 않았습니다 (GOOGLE_API_KEY 또는 GEMINI_API_KEY)");
    }

    const url = `${GEMINI_WS_URL}?key=${apiKey}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(new Error(`WebSocket 연결 실패: ${err}`));
        return;
      }

      this.ws.onopen = () => {
        this.sendSetup();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(
            typeof event.data === "string" ? event.data : event.data.toString(),
          );
          this.handleMessage(message, resolve);
        } catch (err) {
          this.emit("error", new Error(`메시지 파싱 실패: ${err}`));
        }
      };

      this.ws.onerror = (event: Event) => {
        const error = new Error("WebSocket 오류");
        this.emit("error", error);
        if (!this.isConnected) reject(error);
      };

      this.ws.onclose = (event: CloseEvent) => {
        this.isConnected = false;
        this.emit("closed", event.reason || "연결 종료");

        // 자동 재연결 시도 (세션 이어하기 활성화 시)
        if (this.config.enableResumption && this.resumptionHandle) {
          this.attemptReconnect();
        }
      };
    });
  }

  /**
   * 오디오 청크 전송 (마이크 입력)
   * PCM 16kHz 16-bit mono, base64 인코딩
   */
  sendAudio(pcmBase64: string): void {
    if (!this.ws || !this.isConnected) return;

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: pcmBase64,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(message));
    this.stats.audioChunksSent++;
  }

  /**
   * 텍스트 입력 전송 (타이핑 번역)
   */
  sendText(text: string): void {
    if (!this.ws || !this.isConnected) return;

    const message = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 오디오 스트림 일시정지 알림
   * (1초 이상 오디오 전송이 없을 때 호출)
   */
  sendAudioStreamEnd(): void {
    if (!this.ws || !this.isConnected) return;

    const message = {
      realtimeInput: {
        audioStreamEnd: true,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 세션 종료
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  /**
   * 세션 통계 가져오기
   */
  getStats(): {
    durationMs: number;
    audioChunksSent: number;
    audioChunksReceived: number;
    turnsCompleted: number;
    estimatedCostUsd: number;
  } {
    const durationMs = this.stats.startTime > 0
      ? Date.now() - this.stats.startTime
      : 0;
    const durationMin = durationMs / 60_000;

    // 비용 추정: 입력 $0.0015/min + 출력 $0.00375/min
    const estimatedCostUsd = durationMin * (0.0015 + 0.00375);

    return {
      durationMs,
      audioChunksSent: this.stats.audioChunksSent,
      audioChunksReceived: this.stats.audioChunksReceived,
      turnsCompleted: this.stats.turnsCompleted,
      estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    };
  }

  // ==================== Internal ====================

  private sendSetup(): void {
    if (!this.ws) return;

    const voiceName = this.config.voice ?? "Kore";

    // 출력 언어 결정 (mode에서 타겟 언어 추출)
    const { target } = parseTranslationMode(this.config.mode);
    const targetLang = findLanguageByCode(target);
    const outputLang = targetLang?.locale ?? "ko-KR";

    const setup: Record<string, unknown> = {
      setup: {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName,
              },
            },
            languageCode: outputLang,
          },
        },
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(this.config) }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
            endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
            prefixPaddingMs: 200,
            silenceDurationMs: 800,
          },
        },
      },
    };

    // 세션 이어하기 활성화
    if (this.config.enableResumption) {
      (setup.setup as Record<string, unknown>).sessionResumption = this.resumptionHandle
        ? { handle: this.resumptionHandle }
        : {};
    }

    // 컨텍스트 윈도우 압축 (무제한 세션)
    if (this.config.enableCompression) {
      (setup.setup as Record<string, unknown>).contextWindowCompression = {
        triggerTokens: 100000,
        slidingWindow: {
          targetTokens: 50000,
        },
      };
    }

    this.ws.send(JSON.stringify(setup));
  }

  private handleMessage(message: Record<string, unknown>, onSetupResolve?: (value: void) => void): void {
    // Setup 완료
    if (message.setupComplete) {
      this.isConnected = true;
      this.stats.startTime = Date.now();
      this.reconnectAttempts = 0;
      this.emit("connected");
      if (onSetupResolve) onSetupResolve();
      return;
    }

    // 세션 이어하기 핸들 업데이트
    const resumptionUpdate = message.sessionResumptionUpdate as Record<string, unknown> | undefined;
    if (resumptionUpdate?.handle) {
      this.resumptionHandle = String(resumptionUpdate.handle);
    }

    // 서버 응답 처리
    const serverContent = message.serverContent as Record<string, unknown> | undefined;
    if (serverContent) {
      // 인터럽트 (사용자가 말을 끊음)
      if (serverContent.interrupted) {
        this.emit("interrupted");
        return;
      }

      // 모델 턴 (오디오 + 텍스트)
      const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
      if (modelTurn?.parts) {
        const parts = modelTurn.parts as Array<Record<string, unknown>>;
        for (const part of parts) {
          // 오디오 출력
          const inlineData = part.inlineData as Record<string, unknown> | undefined;
          if (inlineData?.data) {
            this.emit("audio", String(inlineData.data));
            this.stats.audioChunksReceived++;
          }

          // 텍스트 출력 (자막용)
          if (part.text) {
            this.emit("transcript", String(part.text), false);
          }
        }
      }

      // 턴 완료
      if (serverContent.turnComplete) {
        this.stats.turnsCompleted++;
        this.emit("turnComplete");
      }
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit("error", new Error("최대 재연결 횟수 초과"));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts) * 1000; // 2s, 4s, 8s, 16s, 32s

    setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        this.attemptReconnect();
      }
    }, delay);
  }
}

// ==================== 편의 함수 ====================

/**
 * 일회성 음성 번역 (짧은 오디오 클립)
 *
 * 전체 WebSocket 세션 없이 단일 오디오를 번역.
 * 짧은 문장/구절 번역에 적합.
 */
export async function translateAudioClip(params: {
  /** Base64 인코딩된 PCM 16kHz 오디오 */
  audioBase64: string;
  /** 번역 방향 (예: "ja-to-ko", "en-to-ko", "bidirectional:ja:ko") */
  mode?: TranslationMode;
  /** 출력 음성 */
  voice?: VoiceName;
}): Promise<{
  translatedAudioBase64: string;
  transcriptText: string;
  latencyMs: number;
}> {
  const start = Date.now();
  let translatedAudio = "";
  let transcriptText = "";

  return new Promise((resolve, reject) => {
    const session = new GeminiLiveTranslator({
      mode: params.mode ?? "ja-to-ko",
      voice: params.voice ?? "Kore",
      enableResumption: false,
      enableCompression: false,
    });

    const audioChunks: string[] = [];

    session.on("audio", (audioBase64: string) => {
      audioChunks.push(audioBase64);
    });

    session.on("transcript", (text: string) => {
      transcriptText += text;
    });

    session.on("turnComplete", () => {
      translatedAudio = audioChunks.join("");
      session.close();
      resolve({
        translatedAudioBase64: translatedAudio,
        transcriptText,
        latencyMs: Date.now() - start,
      });
    });

    session.on("error", (error: Error) => {
      session.close();
      reject(error);
    });

    // 타임아웃 (30초)
    const timeout = setTimeout(() => {
      session.close();
      reject(new Error("음성 번역 시간 초과 (30초)"));
    }, 30_000);

    session.connect().then(() => {
      // 오디오 전송
      session.sendAudio(params.audioBase64);
      // 오디오 끝 알림
      setTimeout(() => session.sendAudioStreamEnd(), 500);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });

    session.on("turnComplete", () => clearTimeout(timeout));
  });
}

/**
 * 통화 통역 세션 생성 헬퍼
 */
export function createCallTranslationSession(options?: {
  mode?: TranslationMode;
  voice?: VoiceName;
  formal?: boolean;
  context?: string;
}): GeminiLiveTranslator {
  return new GeminiLiveTranslator({
    mode: options?.mode ?? "bidirectional",
    voice: options?.voice ?? "Kore",
    formal: options?.formal ?? true,
    context: options?.context ?? "전화 통화 통역",
    enableResumption: true,
    enableCompression: true,
  });
}

// ==================== 포맷터 ====================

/**
 * 세션 상태 → 메시지
 */
export function formatSessionStatus(session: GeminiLiveTranslator): string {
  const stats = session.getStats();

  const durationSec = Math.floor(stats.durationMs / 1000);
  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return [
    "🎙️ 실시간 통역 세션 상태",
    "",
    `⏱️ 진행 시간: ${timeStr}`,
    `🔄 통역 횟수: ${stats.turnsCompleted}회`,
    `💰 예상 비용: $${stats.estimatedCostUsd.toFixed(4)}`,
    `📤 전송: ${stats.audioChunksSent}청크 / 📥 수신: ${stats.audioChunksReceived}청크`,
  ].join("\n");
}

/**
 * 사용 가이드 메시지
 */
export function formatLiveTranslateGuide(): string {
  // 주요 언어 10개만 표시
  const popularLanguages = SUPPORTED_LANGUAGES.filter(
    (l) => ["ja", "en", "zh", "es", "fr", "de", "th", "vi", "ru", "it"].includes(l.code),
  );

  const languageList = popularLanguages
    .map((l) => `${l.flag} ${l.nameKo}`)
    .join("  ");

  return [
    "🎙️ Gemini Live 실시간 통역",
    "",
    "━━ 사용법 ━━",
    "\"통역\" 한마디로 시작!",
    "\"영어 통역\" — 영어↔한국어 통역",
    "\"일본어 통역\" — 일본어↔한국어 통역",
    "\"중국어 통역\" — 중국어↔한국어 통역",
    "",
    "━━ 명령어 ━━",
    "/통역시작 [언어]        — 통역 시작 (기본: 양방향)",
    "/전화통역 [언어]        — 전화 통역 모드",
    "/통역종료               — 통역 세션 종료",
    "/통역상태               — 세션 상태 확인",
    "",
    "━━ 상황별 모드 ━━",
    "/통역시작 일본어 식당   — 식당 맥락 통역",
    "/통역시작 영어 비즈니스 — 비즈니스 맥락",
    "",
    `━━ 지원 언어 (${SUPPORTED_LANGUAGES.length}개) ━━`,
    languageList,
    `외 ${SUPPORTED_LANGUAGES.length - popularLanguages.length}개 언어`,
    "",
    "🤖 Gemini 2.5 Flash Native Audio",
    "⚡ 지연시간: 320~800ms | 💰 ~$0.005/분",
  ].join("\n");
}

/**
 * 언어 선택 퀵 리플라이 목록 (카카오톡 버튼용)
 */
export function getLanguageQuickReplies(): string[] {
  return [
    "일본어 통역",
    "영어 통역",
    "중국어 통역",
    "스페인어 통역",
    "프랑스어 통역",
    "태국어 통역",
    "베트남어 통역",
    "독일어 통역",
  ];
}

/**
 * 모드 라벨 생성 (소스→타겟 표시)
 */
export function formatModeLabel(mode: TranslationMode): string {
  const { source, target, bidirectional } = parseTranslationMode(mode);
  const sourceLang = findLanguageByCode(source);
  const targetLang = findLanguageByCode(target);
  const srcFlag = sourceLang?.flag ?? "🌐";
  const tgtFlag = targetLang?.flag ?? "🌐";
  const srcName = sourceLang?.nameKo ?? source;
  const tgtName = targetLang?.nameKo ?? target;

  if (bidirectional) {
    return `${srcFlag}↔${tgtFlag} ${srcName}↔${tgtName} 양방향`;
  }
  return `${srcFlag}→${tgtFlag} ${srcName}→${tgtName}`;
}
