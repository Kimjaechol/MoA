/**
 * Real-time Interpreter Service
 *
 * Provides instant voice-to-voice translation using Gemini 2.5 Flash Native Audio.
 * Supports bidirectional interpretation between multiple languages.
 *
 * Features:
 * - Real-time voice interpretation (< 500ms latency)
 * - Bidirectional mode (A↔B language switching)
 * - Text translation fallback
 * - Multiple language pairs
 * - Conversation context preservation
 */

import { EventEmitter } from "node:events";
import {
  GeminiLiveProvider,
  createGeminiProvider,
  type VoiceProviderConfig,
  type VoiceSession,
} from "./provider-gemini.js";

// ============================================
// Language Configuration
// ============================================

export type LanguageCode =
  | "ko" | "en" | "ja" | "zh" | "zh-TW"
  | "es" | "fr" | "de" | "it" | "pt"
  | "ru" | "ar" | "hi" | "th" | "vi"
  | "id" | "ms" | "tl" | "nl" | "pl"
  | "tr" | "uk" | "cs" | "sv" | "da";

export interface LanguageInfo {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  voiceName?: string; // Gemini voice optimized for this language
}

export const SUPPORTED_LANGUAGES: Record<LanguageCode, LanguageInfo> = {
  ko: { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷", voiceName: "Kore" },
  en: { code: "en", name: "English", nativeName: "English", flag: "🇺🇸", voiceName: "Puck" },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵", voiceName: "Aoede" },
  zh: { code: "zh", name: "Chinese (Simplified)", nativeName: "中文", flag: "🇨🇳", voiceName: "Charon" },
  "zh-TW": { code: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文", flag: "🇹🇼", voiceName: "Charon" },
  es: { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", voiceName: "Fenrir" },
  fr: { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", voiceName: "Aoede" },
  de: { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", voiceName: "Puck" },
  it: { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹", voiceName: "Fenrir" },
  pt: { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹", voiceName: "Fenrir" },
  ru: { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", voiceName: "Charon" },
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦", voiceName: "Charon" },
  hi: { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳", voiceName: "Kore" },
  th: { code: "th", name: "Thai", nativeName: "ไทย", flag: "🇹🇭", voiceName: "Kore" },
  vi: { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳", voiceName: "Kore" },
  id: { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩", voiceName: "Kore" },
  ms: { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", flag: "🇲🇾", voiceName: "Kore" },
  tl: { code: "tl", name: "Filipino", nativeName: "Tagalog", flag: "🇵🇭", voiceName: "Kore" },
  nl: { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱", voiceName: "Puck" },
  pl: { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱", voiceName: "Puck" },
  tr: { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷", voiceName: "Charon" },
  uk: { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦", voiceName: "Charon" },
  cs: { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", voiceName: "Puck" },
  sv: { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪", voiceName: "Puck" },
  da: { code: "da", name: "Danish", nativeName: "Dansk", flag: "🇩🇰", voiceName: "Puck" },
};

// Popular language pairs for quick access
export const POPULAR_PAIRS: Array<[LanguageCode, LanguageCode]> = [
  ["ko", "en"],  // Korean ↔ English
  ["ko", "ja"],  // Korean ↔ Japanese
  ["ko", "zh"],  // Korean ↔ Chinese
  ["en", "ja"],  // English ↔ Japanese
  ["en", "zh"],  // English ↔ Chinese
  ["en", "es"],  // English ↔ Spanish
  ["en", "fr"],  // English ↔ French
  ["en", "de"],  // English ↔ German
];

// ============================================
// Interpreter Types
// ============================================

export interface InterpreterConfig {
  /** Source language */
  sourceLanguage: LanguageCode;
  /** Target language */
  targetLanguage: LanguageCode;
  /** Enable bidirectional mode (auto-detect and switch) */
  bidirectional: boolean;
  /** Formality level */
  formality: "formal" | "neutral" | "casual";
  /** Domain specialization */
  domain?: "general" | "business" | "medical" | "legal" | "technical";
  /** Preserve speaker's tone and emotion */
  preserveTone: boolean;
  /** API key for Gemini */
  apiKey?: string;
}

export interface InterpreterSession {
  id: string;
  userId: string;
  config: InterpreterConfig;
  status: InterpreterStatus;
  createdAt: Date;
  lastActivity: Date;
  stats: InterpreterStats;
  provider: GeminiLiveProvider | null;
}

export type InterpreterStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "interpreting"
  | "speaking"
  | "error"
  | "closed";

export interface InterpreterStats {
  utteranceCount: number;
  totalDurationMs: number;
  avgLatencyMs: number;
  sourceWords: number;
  targetWords: number;
}

export interface InterpretationResult {
  success: boolean;
  /** Original text (transcribed) */
  originalText?: string;
  /** Detected source language */
  detectedLanguage?: LanguageCode;
  /** Translated text */
  translatedText?: string;
  /** Audio response (base64) */
  audioBase64?: string;
  /** Audio format */
  audioFormat?: string;
  /** Latency in ms */
  latencyMs?: number;
  /** Error message */
  error?: string;
}

// ============================================
// Interpreter Events
// ============================================

export interface InterpreterEvents {
  "session.started": (session: InterpreterSession) => void;
  "session.ready": (session: InterpreterSession) => void;
  "session.error": (error: Error, session: InterpreterSession) => void;
  "session.ended": (session: InterpreterSession) => void;

  "input.started": () => void;
  "input.audio": (chunk: Buffer) => void;
  "input.ended": () => void;
  "input.transcript": (text: string, language: LanguageCode) => void;

  "output.started": () => void;
  "output.audio": (chunk: Buffer) => void;
  "output.text": (text: string, language: LanguageCode) => void;
  "output.ended": () => void;

  "language.detected": (language: LanguageCode) => void;
  "language.switched": (from: LanguageCode, to: LanguageCode) => void;
}

// ============================================
// Real-time Interpreter
// ============================================

/**
 * Build interpreter system prompt
 */
function buildInterpreterPrompt(config: InterpreterConfig): string {
  const sourceLang = SUPPORTED_LANGUAGES[config.sourceLanguage];
  const targetLang = SUPPORTED_LANGUAGES[config.targetLanguage];

  let prompt = `You are a professional real-time interpreter providing instant translation between ${sourceLang.name} and ${targetLang.name}.

## Core Rules:
1. ONLY output the translation - no explanations, no commentary
2. Preserve the speaker's meaning, tone, and intent exactly
3. Use natural, fluent ${targetLang.nativeName} that sounds native
4. Handle cultural nuances appropriately
5. If something is unclear, translate the most likely meaning`;

  if (config.bidirectional) {
    prompt += `

## Bidirectional Mode:
- Automatically detect if input is in ${sourceLang.nativeName} or ${targetLang.nativeName}
- Translate to the OTHER language
- ${sourceLang.nativeName} input → ${targetLang.nativeName} output
- ${targetLang.nativeName} input → ${sourceLang.nativeName} output`;
  }

  // Formality
  const formalityGuide: Record<string, string> = {
    formal: "Use formal, polite language appropriate for professional settings.",
    neutral: "Use standard, neutral language appropriate for most situations.",
    casual: "Use casual, friendly language appropriate for informal conversations.",
  };
  prompt += `\n\n## Formality: ${formalityGuide[config.formality]}`;

  // Domain specialization
  if (config.domain && config.domain !== "general") {
    const domainGuides: Record<string, string> = {
      business: "Use business/corporate terminology and formal expressions.",
      medical: "Use accurate medical terminology. Be precise with symptoms, treatments, and diagnoses.",
      legal: "Use proper legal terminology. Be precise with legal concepts and terms.",
      technical: "Use accurate technical terminology for IT, engineering, and scientific contexts.",
    };
    prompt += `\n\n## Domain: ${domainGuides[config.domain]}`;
  }

  // Tone preservation
  if (config.preserveTone) {
    prompt += `

## Tone Preservation:
- Match the speaker's emotional tone (excited, serious, worried, etc.)
- Preserve emphasis and urgency
- Reflect the speaker's personality in the translation`;
  }

  prompt += `

## Output Format:
- Respond ONLY with the translated text
- No quotation marks, no labels, no explanations
- Speak naturally as if you ARE the speaker in the target language`;

  return prompt;
}

/**
 * Real-time Interpreter using Gemini Live API
 */
export class RealtimeInterpreter extends EventEmitter {
  private sessions: Map<string, InterpreterSession> = new Map();

  /**
   * Start a new interpretation session
   */
  async startSession(
    userId: string,
    config: InterpreterConfig,
  ): Promise<InterpreterSession> {
    const sessionId = `interp-${userId}-${Date.now()}`;

    const session: InterpreterSession = {
      id: sessionId,
      userId,
      config,
      status: "connecting",
      createdAt: new Date(),
      lastActivity: new Date(),
      stats: {
        utteranceCount: 0,
        totalDurationMs: 0,
        avgLatencyMs: 0,
        sourceWords: 0,
        targetWords: 0,
      },
      provider: null,
    };

    this.sessions.set(sessionId, session);
    this.emit("session.started", session);

    try {
      // Create Gemini provider with interpreter prompt
      const targetLang = SUPPORTED_LANGUAGES[config.targetLanguage];

      const provider = createGeminiProvider({
        apiKey: config.apiKey,
        model: "gemini-2.5-flash-preview-native-audio-dialog",
        voice: targetLang.voiceName ?? "Kore",
        instructions: buildInterpreterPrompt(config),
        enableVAD: true,
        vadThreshold: 0.4, // Lower threshold for quicker response
        silenceDurationMs: 300, // Faster turn-taking for interpretation
      });

      session.provider = provider;

      // Set up event forwarding
      this.setupProviderEvents(session, provider);

      // Connect
      await provider.connect(userId);

      session.status = "ready";
      this.emit("session.ready", session);

      return session;
    } catch (err) {
      session.status = "error";
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit("session.error", error, session);
      throw err;
    }
  }

  /**
   * Set up event forwarding from provider
   */
  private setupProviderEvents(
    session: InterpreterSession,
    provider: GeminiLiveProvider,
  ): void {
    provider.on("input.started", () => {
      session.status = "listening";
      session.lastActivity = new Date();
      this.emit("input.started");
    });

    provider.on("input.audio", (chunk: Buffer) => {
      this.emit("input.audio", chunk);
    });

    provider.on("input.ended", () => {
      session.status = "interpreting";
      this.emit("input.ended");
    });

    provider.on("input.transcript", (text: string) => {
      session.stats.utteranceCount++;
      session.stats.sourceWords += text.split(/\s+/).length;

      // Detect language for bidirectional mode
      const detectedLang = this.detectLanguage(text, session.config);
      this.emit("input.transcript", text, detectedLang);

      if (session.config.bidirectional) {
        // Check if we need to switch languages
        const expectedSource = session.config.sourceLanguage;
        if (detectedLang !== expectedSource) {
          this.emit("language.detected", detectedLang);
        }
      }
    });

    provider.on("response.started", () => {
      session.status = "speaking";
      this.emit("output.started");
    });

    provider.on("response.audio", (chunk: Buffer) => {
      this.emit("output.audio", chunk);
    });

    provider.on("response.text", (text: string, isFinal: boolean) => {
      if (isFinal) {
        session.stats.targetWords += text.split(/\s+/).length;
      }
      const targetLang = session.config.bidirectional
        ? this.getTargetLanguage(session)
        : session.config.targetLanguage;
      this.emit("output.text", text, targetLang);
    });

    provider.on("response.ended", () => {
      session.status = "ready";
      session.lastActivity = new Date();
      this.emit("output.ended");
    });

    provider.on("session.error", (error: Error) => {
      session.status = "error";
      this.emit("session.error", error, session);
    });

    provider.on("session.closed", (reason: string) => {
      session.status = "closed";
      this.emit("session.ended", session);
    });
  }

  /**
   * Simple language detection based on character sets
   */
  private detectLanguage(text: string, config: InterpreterConfig): LanguageCode {
    // Korean detection (Hangul)
    if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return "ko";

    // Japanese detection (Hiragana, Katakana, some Kanji patterns)
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja";

    // Chinese detection (CJK without Japanese kana)
    if (/[\u4E00-\u9FFF]/.test(text) && !/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
      return config.sourceLanguage === "zh-TW" || config.targetLanguage === "zh-TW"
        ? "zh-TW"
        : "zh";
    }

    // Arabic
    if (/[\u0600-\u06FF]/.test(text)) return "ar";

    // Thai
    if (/[\u0E00-\u0E7F]/.test(text)) return "th";

    // Russian/Cyrillic
    if (/[\u0400-\u04FF]/.test(text)) return "ru";

    // Default to source or English
    return config.sourceLanguage === "en" ? config.targetLanguage : config.sourceLanguage;
  }

  /**
   * Get target language for bidirectional mode
   */
  private getTargetLanguage(session: InterpreterSession): LanguageCode {
    // In bidirectional mode, target is whatever is NOT the detected input
    return session.config.targetLanguage;
  }

  /**
   * Send audio to interpreter
   */
  sendAudio(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session?.provider) return;

    session.provider.sendAudio(chunk);
  }

  /**
   * Send text for translation (instead of audio)
   */
  sendText(sessionId: string, text: string): void {
    const session = this.sessions.get(sessionId);
    if (!session?.provider) return;

    session.provider.sendText(text);
  }

  /**
   * End interpretation session
   */
  async endSession(sessionId: string): Promise<InterpreterStats | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Calculate final stats
    session.stats.totalDurationMs = Date.now() - session.createdAt.getTime();

    if (session.provider) {
      await session.provider.disconnect();
    }

    session.status = "closed";
    this.sessions.delete(sessionId);
    this.emit("session.ended", session);

    return session.stats;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): InterpreterSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions for a user
   */
  getUserSessions(userId: string): InterpreterSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.userId === userId && s.status !== "closed",
    );
  }

  /**
   * Get active session count
   */
  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}

// ============================================
// Text Translation Service
// ============================================

export interface TranslationRequest {
  text: string;
  sourceLanguage?: LanguageCode; // Auto-detect if not provided
  targetLanguage: LanguageCode;
  formality?: "formal" | "neutral" | "casual";
  domain?: "general" | "business" | "medical" | "legal" | "technical";
}

export interface TranslationResult {
  success: boolean;
  originalText: string;
  translatedText?: string;
  detectedLanguage?: LanguageCode;
  confidence?: number;
  alternativeTranslations?: string[];
  error?: string;
}

/**
 * Text translation using Gemini API
 */
export async function translateText(
  request: TranslationRequest,
  apiKey?: string,
): Promise<TranslationResult> {
  const key = apiKey ??
    process.env.GOOGLE_API_KEY ??
    process.env.GEMINI_API_KEY ??
    process.env.MOLTBOT_GEMINI_API_KEY;

  if (!key) {
    return {
      success: false,
      originalText: request.text,
      error: "API key not configured",
    };
  }

  const targetLang = SUPPORTED_LANGUAGES[request.targetLanguage];

  // Build translation prompt
  let prompt = `Translate the following text to ${targetLang.nativeName}.`;

  if (request.sourceLanguage) {
    const sourceLang = SUPPORTED_LANGUAGES[request.sourceLanguage];
    prompt = `Translate the following ${sourceLang.nativeName} text to ${targetLang.nativeName}.`;
  }

  if (request.formality) {
    const formalityMap = {
      formal: "Use formal, polite language.",
      neutral: "Use standard language.",
      casual: "Use casual, friendly language.",
    };
    prompt += ` ${formalityMap[request.formality]}`;
  }

  if (request.domain && request.domain !== "general") {
    prompt += ` Use appropriate ${request.domain} terminology.`;
  }

  prompt += `

IMPORTANT: Output ONLY the translation. No explanations, no quotes, no labels.

Text to translate:
${request.text}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      return {
        success: false,
        originalText: request.text,
        error: `Translation API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
    };

    const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!translatedText) {
      return {
        success: false,
        originalText: request.text,
        error: "No translation returned",
      };
    }

    return {
      success: true,
      originalText: request.text,
      translatedText,
      detectedLanguage: request.sourceLanguage,
    };
  } catch (err) {
    return {
      success: false,
      originalText: request.text,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================
// Factory & Utilities
// ============================================

/**
 * Create interpreter instance
 */
export function createInterpreter(): RealtimeInterpreter {
  return new RealtimeInterpreter();
}

/**
 * Format language list for display
 */
export function formatLanguageList(): string {
  let output = "🌍 **지원 언어 목록**\n\n";

  // Group by region
  const regions: Record<string, LanguageCode[]> = {
    "동아시아": ["ko", "ja", "zh", "zh-TW"],
    "동남아시아": ["th", "vi", "id", "ms", "tl"],
    "남아시아": ["hi"],
    "유럽": ["en", "es", "fr", "de", "it", "pt", "nl", "pl", "cs", "sv", "da"],
    "동유럽": ["ru", "uk", "tr"],
    "중동": ["ar"],
  };

  for (const [region, codes] of Object.entries(regions)) {
    output += `**${region}**\n`;
    for (const code of codes) {
      const lang = SUPPORTED_LANGUAGES[code];
      output += `${lang.flag} ${lang.nativeName} (\`${code}\`)\n`;
    }
    output += "\n";
  }

  return output;
}

/**
 * Format popular pairs for display
 */
export function formatPopularPairs(): string {
  let output = "⭐ **인기 언어 조합**\n\n";

  for (const [src, tgt] of POPULAR_PAIRS) {
    const srcLang = SUPPORTED_LANGUAGES[src];
    const tgtLang = SUPPORTED_LANGUAGES[tgt];
    output += `${srcLang.flag} ${srcLang.nativeName} ↔ ${tgtLang.flag} ${tgtLang.nativeName}\n`;
  }

  return output;
}

/**
 * Parse language code from user input
 */
export function parseLanguageCode(input: string): LanguageCode | null {
  const normalized = input.toLowerCase().trim();

  // Direct code match
  if (normalized in SUPPORTED_LANGUAGES) {
    return normalized as LanguageCode;
  }

  // Korean aliases
  const aliases: Record<string, LanguageCode> = {
    // Korean
    "한국어": "ko", "한글": "ko", "korean": "ko",
    // English
    "영어": "en", "english": "en",
    // Japanese
    "일본어": "ja", "일어": "ja", "japanese": "ja",
    // Chinese
    "중국어": "zh", "중문": "zh", "chinese": "zh",
    "번체": "zh-TW", "대만어": "zh-TW", "traditional": "zh-TW",
    // Spanish
    "스페인어": "es", "spanish": "es",
    // French
    "프랑스어": "fr", "불어": "fr", "french": "fr",
    // German
    "독일어": "de", "독어": "de", "german": "de",
    // Italian
    "이탈리아어": "it", "italian": "it",
    // Portuguese
    "포르투갈어": "pt", "portuguese": "pt",
    // Russian
    "러시아어": "ru", "노어": "ru", "russian": "ru",
    // Arabic
    "아랍어": "ar", "arabic": "ar",
    // Hindi
    "힌디어": "hi", "hindi": "hi",
    // Thai
    "태국어": "th", "thai": "th",
    // Vietnamese
    "베트남어": "vi", "월남어": "vi", "vietnamese": "vi",
    // Indonesian
    "인도네시아어": "id", "indonesian": "id",
    // Dutch
    "네덜란드어": "nl", "dutch": "nl",
    // Turkish
    "터키어": "tr", "turkish": "tr",
  };

  return aliases[normalized] ?? null;
}
