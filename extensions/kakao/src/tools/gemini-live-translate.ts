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

export type TranslationMode =
  | "ja-to-ko"   // 일본어 → 한국어 (일본 여행 시 상대방 말 이해)
  | "ko-to-ja"   // 한국어 → 일본어 (내가 말할 때)
  | "bidirectional"; // 양방향 자동 감지

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
  /** 번역 모드 */
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
  const formalityNote = config.formal !== false
    ? "번역 시 항상 정중한 존댓말(です/ます体, 합니다체)을 사용하세요."
    : "번역 시 친근한 반말(タメ口, 해체)을 사용하세요.";

  const contextNote = config.context
    ? `\n현재 상황: ${config.context}. 이 맥락에 맞는 적절한 용어와 표현을 사용하세요.`
    : "";

  switch (config.mode) {
    case "ja-to-ko":
      return [
        "당신은 전문 일본어→한국어 실시간 통역사입니다.",
        "일본어 음성을 듣고 즉시 자연스러운 한국어로 통역하세요.",
        formalityNote,
        "통역만 하세요. 설명이나 주석을 추가하지 마세요.",
        "고유명사(인명, 지명, 브랜드)는 원어 발음을 한국어로 표기하세요.",
        "숫자, 단위, 통화는 한국식으로 변환하세요 (例: 千円 → 천엔).",
        contextNote,
      ].filter(Boolean).join("\n");

    case "ko-to-ja":
      return [
        "あなたはプロの韓国語→日本語リアルタイム通訳者です。",
        "韓国語の音声を聞いて、すぐに自然な日本語に通訳してください。",
        config.formal !== false
          ? "丁寧語（です・ます調）を使ってください。"
          : "カジュアルな話し方（タメ口）を使ってください。",
        "通訳だけしてください。説明やコメントは付けないでください。",
        "固有名詞（人名、地名、ブランド）は原語の発音をカタカナで表記してください。",
        contextNote,
      ].filter(Boolean).join("\n");

    case "bidirectional":
      return [
        "당신은 한국어↔일본어 양방향 실시간 통역사입니다.",
        "화자가 일본어로 말하면 한국어로, 한국어로 말하면 일본어로 즉시 통역하세요.",
        "언어를 자동으로 감지하여 반대 언어로 통역하세요.",
        formalityNote,
        "통역만 하세요. 설명이나 주석을 추가하지 마세요.",
        "고유명사는 해당 언어의 발음 표기법을 따르세요.",
        contextNote,
      ].filter(Boolean).join("\n");

    default:
      return "You are a real-time translator. Translate speech immediately.";
  }
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

    // 출력 언어 결정
    const outputLang = this.config.mode === "ko-to-ja" ? "ja-JP" : "ko-KR";

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
  /** 번역 방향 */
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
  return [
    "🎙️ Gemini Live 실시간 통역",
    "",
    "━━ 통역 모드 ━━",
    "🇯🇵→🇰🇷  일본어→한국어 (상대방 말 이해하기)",
    "🇰🇷→🇯🇵  한국어→일본어 (내가 말하기)",
    "🔄      양방향 자동 감지 (전화 통화)",
    "",
    "━━ 사용 방법 ━━",
    "/통역시작              — 양방향 통역 시작",
    "/통역시작 일→한        — 일본어→한국어 모드",
    "/통역시작 한→일        — 한국어→일본어 모드",
    "/통역종료              — 통역 세션 종료",
    "/통역상태              — 세션 상태 확인",
    "",
    "━━ 통화 통역 ━━",
    "/전화통역              — 전화 통역 모드 시작",
    "  → 상대방 일본어 → 실시간 한국어 통역",
    "  → 내 한국어 → 실시간 일본어 통역",
    "",
    "━━ 상황별 모드 ━━",
    "/통역시작 식당          — 식당 맥락 통역",
    "/통역시작 교통          — 교통/택시 맥락",
    "/통역시작 쇼핑          — 쇼핑/면세 맥락",
    "/통역시작 긴급          — 긴급상황 맥락",
    "",
    "🤖 Gemini 2.5 Flash Native Audio",
    "⚡ 지연시간: 320~800ms | 💰 ~$0.005/분",
  ].join("\n");
}
